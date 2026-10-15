import { readFileSync } from "node:fs";
import type { LoadedCompiler } from "@aufbau/compiler";
import { loadCompiler } from "@aufbau/compiler";
import type { SurfaceLanguage } from "@aufbau/syntax";
import type { TableauDocument, TableauEnd } from "../../src/tableau/document";
import { setEnd, splitNode, stackRows } from "../../src/tableau/edit";
import type { Formula } from "../../src/worker/exercise-kit/formula";
import { parseFormula } from "../../src/worker/exercise-kit/formula";
import {
  heldInstances,
  readTreeDiagnostics,
} from "../../src/worker/exercises/truth-tree/aufbau/emit";
import {
  resolveTruthTree,
  treeProofOf,
} from "../../src/worker/exercises/truth-tree/grading";
import type { TreeReport } from "../../src/worker/exercises/truth-tree/logic/check";
import { checkTree } from "../../src/worker/exercises/truth-tree/logic/check";
import { rowReader } from "../../src/worker/exercises/truth-tree/logic/formulas";
import type { TableauSystem } from "../../src/worker/exercises/truth-tree/logic/system";
import { FORALLX_UBC } from "../../src/worker/exercises/truth-tree/logic/system";
import type { TruthTreePublicData } from "../../src/worker/exercises/truth-tree/types";
import { languageById } from "../../src/worker/logic/specs";

export const UBC = (() => {
  const found = languageById("forallx-ubc");

  if (found === null) {
    throw new Error("forallx-ubc does not ship");
  }

  return found;
})();

export function ubcFormula(
  text: string,
  lang: SurfaceLanguage = UBC,
): Formula {
  const read = parseFormula(text, lang);

  if (!read.ok) {
    throw new Error(`'${text}' does not parse: ${read.errors[0]?.message}`);
  }

  return read.formula;
}

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

  check(
    root?: readonly Formula[],
    system: TableauSystem = FORALLX_UBC,
  ): TreeReport {
    return checkTree({
      reader: rowReader(UBC),
      root: root ?? this.rootTexts.map((text) => ubcFormula(text)),
      system,
      tree: this.document,
    });
  }
}

let compiler: Promise<LoadedCompiler> | null = null;

function engine(): Promise<LoadedCompiler> {
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
  readonly mmb?: string;
}

/**
 * A tree as the browser submits it: the instances its general steps were
 * written with, found by asking the engine, and its certificate, base64,
 * compiled against the exercise's theory (`publicData` as the systems join
 * gives it). No `mmb` where the compile does not certify every inference.
 */
export async function certifyAnswer(
  publicData: TruthTreePublicData,
  answer: { readonly nodes: unknown; readonly rules?: unknown },
): Promise<CertifiedAnswer> {
  const loaded = await engine();
  const resolved = resolveTruthTree(publicData);
  const mm0 = publicData.mm0;

  if (resolved === null || mm0 === undefined) {
    return answer;
  }

  const data = answer as never;
  const slots = treeProofOf(resolved, data, new Map()).slots;
  const asking = treeProofOf(resolved, data, slots);

  if (asking.goal === null || asking.proof === null) {
    return answer;
  }

  const asked = loaded.compile(`${mm0}\n${asking.goal}\n`, asking.proof);
  const held = heldInstances(
    asking,
    readTreeDiagnostics(asked.ok ? [] : asked.diagnostics, asking),
  );
  const instances = Object.fromEntries(held);
  const submitted = {
    ...answer,
    ...(held.size === 0 ? {} : { instances }),
  };
  const final = treeProofOf(resolved, submitted as never);

  if (final.goal === null || final.proof === null) {
    return submitted;
  }

  const result = loaded.compile(`${mm0}\n${final.goal}\n`, final.proof);

  return result.ok && result.mmbBytes !== undefined
    ? { ...submitted, mmb: Buffer.from(result.mmbBytes).toString("base64") }
    : submitted;
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
