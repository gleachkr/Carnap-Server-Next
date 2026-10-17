import { expect } from "bun:test";
import type { LoadedCompiler } from "@aufbau/compiler";
import { readCompileResult } from "../../src/client/proof-compiler";
import type { TableauDocument, TableauEnd } from "../../src/tableau/document";
import {
  setEnd,
  setRowCites,
  splitNode,
  stackRows,
} from "../../src/tableau/edit";
import { compileCarnapMarkdown } from "../../src/worker/application/content/compiler";
import type { ExerciseManifestItem } from "../../src/worker/domain/content";
import { verifyMmb } from "../../src/worker/exercise-kit/proof/verifier";
import { withSystemText } from "../../src/worker/exercise-kit/systems/join";
import { TRUTH_TREE_EXERCISE } from "../../src/worker/exercises/truth-tree";
import {
  askingProofOf,
  readAsked,
} from "../../src/worker/exercises/truth-tree/ask";
import type { TreeEvidence } from "../../src/worker/exercises/truth-tree/aufbau/judge";
import type { ResolvedTree } from "../../src/worker/exercises/truth-tree/grading";
import {
  judgeTree,
  resolveTruthTree,
  treeProofOf,
} from "../../src/worker/exercises/truth-tree/grading";
import type { TreeReport } from "../../src/worker/exercises/truth-tree/report";
import type {
  TruthTreeAnswerData,
  TruthTreePublicData,
} from "../../src/worker/exercises/truth-tree/types";
import {
  TRUTH_TREE_ANSWER_KIND,
  TRUTH_TREE_SCHEMA_VERSION,
} from "../../src/worker/exercises/truth-tree/types";
import { theorySourceByFileName } from "../../src/worker/logic/theories";
import { engine } from "./engine";

/** A truth-tree exercise as a lesson compiles it, joined with its systems. */
export interface TreeExercise {
  /** The manifest entry, its public data joined as the browser gets it. */
  readonly item: ExerciseManifestItem;
  readonly publicData: TruthTreePublicData;
  readonly resolved: ResolvedTree;
  /** The frozen theory, its `@syntax` stripped, as the engine takes it. */
  readonly mm0: string;
}

/** A lesson's first exercise, which must be a truth tree that resolves. */
export async function lessonTree(source: string): Promise<TreeExercise> {
  const result = await compileCarnapMarkdown(source);

  if (!result.ok) {
    throw new Error(
      result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"),
    );
  }

  const raw = result.artifact.manifest[0] as ExerciseManifestItem;
  const publicData = withSystemText(
    raw.publicData,
    result.artifact.systems,
  ) as unknown as TruthTreePublicData;
  const resolved = resolveTruthTree(publicData);

  if (resolved === null || publicData.mm0 === undefined) {
    throw new Error("the exercise does not resolve");
  }

  return {
    item: { ...raw, publicData: publicData as never },
    mm0: publicData.mm0,
    publicData,
    resolved,
  };
}

/**
 * A truth-tree exercise whose root is `root`, its rows in order as the theory
 * writes them, in `system` (the directive's default where absent) and with
 * `finish` (likewise).
 */
export function treeExercise(
  root: readonly string[],
  options: {
    readonly system?: string;
    readonly finish?: string;
    readonly prompt?: string;
  } = {},
): Promise<TreeExercise> {
  const attributes = [
    "#t",
    ...(options.system === undefined ? [] : [`system="${options.system}"`]),
    ...(options.finish === undefined ? [] : [`finish="${options.finish}"`]),
  ].join(" ");

  return lessonTree(
    `::::truth-tree{${attributes}}\n${options.prompt ?? "Show it."}\n\n${root.map((row) => `- ${row}`).join("\n")}\n::::`,
  );
}

/** Each problem as `row|end id: type`, in tree order. */
export function problems(report: TreeReport): string[] {
  return report.problems.map(({ at }) =>
    at.type === "tree"
      ? `tree: ${at.problem.type}`
      : `${at.type} ${at.id}: ${at.problem.type}`,
  );
}

/**
 * The text of a built-in theory file from `start` up to `end`, both of which
 * it must have: for the theories whose headers say they share a part with
 * another word for word.
 */
export function section(file: string, start: string, end: string): string {
  const text = theorySourceByFileName(file) ?? "";
  const from = text.indexOf(start);
  const to = text.indexOf(end, from);

  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);

  return text.slice(from, to);
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

  /**
   * Make `rows` cite `cites` instead, as the editor's citation field does:
   * a step may come to cite a row written after it.
   */
  recite(rows: readonly string[], ...cites: string[]): this {
    this.document = setRowCites(this.document, rows, cites);
    return this;
  }

  /** Change the tree as the editor never would, for a shape it cannot make. */
  reshape(change: (document: TableauDocument) => TableauDocument): this {
    this.document = change(this.document);
    return this;
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
export async function judgeAsBrowser(
  exercise: TreeExercise,
  tree: TreeBuilder,
): Promise<TreeReport> {
  const browsed = askAsBrowser(
    await engine(),
    exercise.resolved,
    exercise.mm0,
    tree.answer(),
  );

  return judgeTree(
    exercise.resolved,
    browsed.answer as never,
    browsed.evidence,
  ).report;
}

/**
 * The report on a submitted answer, as the server makes it: its certificate,
 * where it has one, verified against the goal written from the answer, and
 * none verified where it has none.
 */
export async function judgeAsServer(
  exercise: TreeExercise,
  answer: CertifiedAnswer,
): Promise<TreeReport> {
  const data = answer as unknown as TruthTreeAnswerData;
  const proof = treeProofOf(exercise.resolved, data);
  const verified =
    answer.mmb !== undefined && proof.goal !== null
      ? (
          await verifyMmb(
            `${exercise.mm0}\n${proof.goal}\n`,
            Buffer.from(answer.mmb, "base64"),
          )
        ).ok
      : false;

  return judgeTree(
    exercise.resolved,
    data,
    { kind: "verified", ok: verified },
    proof,
  ).report;
}

/**
 * A submitted answer's status, as the grader gives it: normalized, its
 * certificate verified, and judged.
 */
export async function gradeAnswer(
  item: ExerciseManifestItem,
  data: CertifiedAnswer,
): Promise<string> {
  const normalized = TRUTH_TREE_EXERCISE.normalizeAnswer(
    {
      data: data as never,
      kind: TRUTH_TREE_ANSWER_KIND,
      schemaVersion: TRUTH_TREE_SCHEMA_VERSION,
    },
    item,
  );

  if (!normalized.ok) {
    throw new Error(`answer refused: ${normalized.reason}`);
  }

  const evaluation = await TRUTH_TREE_EXERCISE.evaluate(
    normalized.answer,
    item,
    {
      ...(normalized.certificate === undefined
        ? {}
        : { certificate: normalized.certificate }),
      now: new Date("2026-01-01T00:00:00Z"),
    } as never,
  );

  return evaluation.status;
}
