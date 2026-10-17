import { readFileSync } from "node:fs";
import type { LoadedCompiler } from "@aufbau/compiler";
import { loadCompiler } from "@aufbau/compiler";
import { readCompileResult } from "../../src/client/proof-compiler";
import type { TableauDocument, TableauEnd } from "../../src/tableau/document";
import { setEnd, splitNode, stackRows } from "../../src/tableau/edit";
import {
  askingProofOf,
  readAsked,
} from "../../src/worker/exercises/truth-tree/ask";
import type { TreeEvidence } from "../../src/worker/exercises/truth-tree/aufbau/judge";
import type { ResolvedTree } from "../../src/worker/exercises/truth-tree/grading";
import {
  judgeTree,
  resolveTruthTree,
} from "../../src/worker/exercises/truth-tree/grading";
import type { TreeReport } from "../../src/worker/exercises/truth-tree/report";
import type {
  TruthTreeAnswerData,
  TruthTreePublicData,
} from "../../src/worker/exercises/truth-tree/types";

/**
 * Builds a truth tree the way the editor does, through the tableau's own edit
 * operations: each `stack` and `split` is one development, citing one row
 * (or two, for a substitution by an identity).
 * The root rows are `r1`, `r2`, …, and each call returns the ids it made, so
 * a test can say which row a problem is on.
 */
export class TreeBuilder {
  private document: TableauDocument;
  private next = 0;
  readonly root: readonly string[];
  readonly rootNode = "n0";

  constructor(readonly rootTexts: readonly string[]) {
    this.document = {
      nodes: [
        {
          id: "n0",
          parent: null,
          rows: rootTexts.map((text, at) => ({
            cites: [],
            dev: "root",
            id: `r${at + 1}`,
            text,
          })),
        },
      ],
    };
    this.next = rootTexts.length;
    this.root = rootTexts.map((_, at) => `r${at + 1}`);
  }

  /** The rule each development names, by its `dev`, where one was given. */
  readonly rules = new Map<string, string>();

  private mint = (): string => {
    this.next += 1;
    return `t${this.next}`;
  };

  /**
   * Stack rows at the end of a node, citing `cite` (or, for a substitution by
   * an identity, two rows): one development.
   */
  stack(
    node: string,
    cite: string | readonly string[] | null,
    texts: readonly string[],
    rule?: string,
  ): string[] {
    const dev = this.mint();

    if (rule !== undefined) {
      this.rules.set(dev, rule);
    }

    const made = stackRows(
      this.document,
      node,
      texts.map((text) => ({
        cites:
          cite === null ? [] : typeof cite === "string" ? [cite] : [...cite],
        dev,
        text,
      })),
      this.mint,
    );
    this.document = made.document;
    return [...made.rows];
  }

  /**
   * Split a leaf, citing `cite`: one development over its new branches. The
   * result is typed as at least two branches, which every split is, so a
   * test can destructure it.
   */
  split(
    node: string,
    cite: string | null,
    branches: readonly (readonly string[])[],
    rule?: string,
  ): {
    readonly nodes: readonly [string, string, ...string[]];
    readonly rows: readonly [string[], string[], ...string[][]];
  } {
    const dev = this.mint();

    if (rule !== undefined) {
      this.rules.set(dev, rule);
    }

    const made = splitNode(
      this.document,
      node,
      branches.map((texts) =>
        texts.map((text) => ({
          cites: cite === null ? [] : [cite],
          dev,
          text,
        })),
      ),
      this.mint,
    );
    this.document = made.document;
    let offset = 0;
    const rows = branches.map((texts) => {
      const slice = made.rows.slice(offset, offset + texts.length);
      offset += texts.length;
      return [...slice];
    });
    return {
      nodes: made.nodes as unknown as readonly [string, string, ...string[]],
      rows: rows as unknown as [string[], string[], ...string[][]],
    };
  }

  /** The tree as a submitted answer: the document and its rules. */
  answer(): {
    readonly nodes: TableauDocument["nodes"];
    readonly rules: Readonly<Record<string, string>>;
  } {
    return {
      nodes: this.document.nodes,
      rules: Object.fromEntries(this.rules),
    };
  }

  close(node: string, ...cites: string[]): this {
    return this.end(node, { cites, type: "closed" });
  }

  open(node: string): this {
    return this.end(node, { type: "open" });
  }

  private end(node: string, end: TableauEnd): this {
    this.document = setEnd(this.document, node, end);
    return this;
  }

  get tree(): TableauDocument {
    return this.document;
  }
}

let compiler: Promise<LoadedCompiler> | null = null;

export function engine(): Promise<LoadedCompiler> {
  compiler ??= loadCompiler({
    wasmBytes: readFileSync(
      new URL(
        "../../node_modules/@aufbau/compiler/compiler.wasm",
        import.meta.url,
      ),
    ),
  });

  return compiler;
}

/** A tree's answer as the browser would submit it. */
export interface CertifiedAnswer {
  readonly nodes: unknown;
  readonly rules?: unknown;
  readonly instances?: Readonly<Record<string, string>>;
  readonly directions?: Readonly<Record<string, string>>;
  readonly mmb?: string;
}

/** What the browser makes of a tree once a submit has its certificate. */
interface Browsed {
  /** The answer with the instances and directions the engine found. */
  readonly answer: CertifiedAnswer;
  /** The evidence its report is made with, after the owed compile. */
  readonly evidence: TreeEvidence;
}

/**
 * Ask the engine about a tree and certify it, as the editor does: one compile
 * asking every candidate, read through the editor's own reader, and the
 * compile owed for the certificate where the derivation changed.
 */
function askAsBrowser(
  compiler: LoadedCompiler,
  resolved: ResolvedTree,
  mm0: string,
  answer: TruthTreeAnswerData,
): Browsed {
  const asking = askingProofOf(resolved, answer);

  if (asking.goal === null || asking.proof === null) {
    return {
      answer,
      evidence: { certified: false, errors: [], kind: "compiled" },
    };
  }

  const compile = (goal: string, proof: string) =>
    readCompileResult(compiler.compile(`${mm0}\n${goal}\n`, proof));
  const asked = compile(asking.goal, asking.proof);
  const read = readAsked(resolved, answer, asking, {
    certified: asked.certificate !== null,
    diagnostics: asked.problems,
  });
  const certificate =
    read.owed === null
      ? asked.certificate
      : compile(read.owed.goal, read.owed.proof).certificate;
  const certified =
    read.owed === null ? read.certified : certificate !== null;

  return {
    answer: {
      ...answer,
      ...(read.instances.size === 0
        ? {}
        : { instances: Object.fromEntries(read.instances) }),
      ...(read.directions.size === 0
        ? {}
        : { directions: Object.fromEntries(read.directions) }),
      ...(certified && certificate !== null
        ? { mmb: Buffer.from(certificate).toString("base64") }
        : {}),
    },
    evidence: { certified, errors: read.errors, kind: "compiled" },
  };
}

/**
 * A tree as the browser submits it: the instances its general steps were
 * written with and the directions its identities are developed in, found by
 * asking the engine, and its certificate, base64, compiled against the
 * exercise's theory (`publicData` as the systems join gives it). No `mmb`
 * where the compile does not certify every inference.
 */
export async function certifyAnswer(
  publicData: TruthTreePublicData,
  answer: { readonly nodes: unknown; readonly rules?: unknown },
): Promise<CertifiedAnswer> {
  const resolved = resolveTruthTree(publicData);
  const mm0 = publicData.mm0;

  if (resolved === null || mm0 === undefined) {
    return answer;
  }

  return askAsBrowser(await engine(), resolved, mm0, answer as never).answer;
}

/**
 * A tree's certificate, as the browser compiles it, or `undefined` where the
 * compile does not certify every inference. For a tree with no general steps;
 * {@link certifyAnswer} gives the instances a certificate states.
 */
export async function certifyTree(
  publicData: TruthTreePublicData,
  answer: { readonly nodes: unknown; readonly rules?: unknown },
): Promise<string | undefined> {
  return (await certifyAnswer(publicData, answer)).mmb;
}

/** The report on a tree, as the browser makes it once a submit certifies. */
export function judgeAsBrowser(
  compiler: LoadedCompiler,
  resolved: ResolvedTree,
  mm0: string,
  answer: {
    readonly nodes: TableauDocument["nodes"];
    readonly rules: Readonly<Record<string, string>>;
  },
): TreeReport {
  const browsed = askAsBrowser(compiler, resolved, mm0, answer);

  return judgeTree(resolved, browsed.answer as never, browsed.evidence)
    .report;
}
