/**
 * The playground: a proof exercise whose goal is whatever the proof proves.
 *
 * Carnap had one, and it is how a student checks that a derivation is
 * well-formed before anyone has decided what it should derive. An ordinary
 * proof exercise freezes `theorem <goal>: $ Γ ⊢ φ $;` beside the theory when
 * the lesson compiles, and the certificate is verified against that text. A
 * playground has no goal to freeze: its statement is the proof's own last
 * line — the Fitch proof's final line with its ambient context, the tree's
 * root, the Prawitz root with its dependency context, the linear proof's last
 * line — which the translators already emit as the last `$ … $` of the `.auf`.
 * The engine's final reconciliation (last line matches the header) is then
 * true by construction, and what is left to check is what a playground asks:
 * that every line is justified.
 *
 * The mechanism is otherwise the ordinary one, and that is the point. The
 * client appends `theorem playground {…}: $ Γ ⊢ φ $;` to the frozen theory
 * and compiles the usual `playground\n----\n…` against it; the answer carries
 * the statement it derived (binders and sequent) as data; and the worker
 * rebuilds the same declaration from the answer, verifies the certificate
 * against it, and shows the statement as the review's goal. The verdict means
 * "a valid proof of Γ ⊢ φ", and Γ ⊢ φ is on the page. (A lemma-only `.auf`
 * would compile and verify against the theory alone, but attests nothing the
 * review could name.)
 *
 * **Binders are the `@vars` tokens the statement holds, and nothing else.**
 * A goal's binders are the scope its lines are read in (#253), and here the
 * goal is derived *from* the lines: a binder that could shadow the lexicon
 * would make the derivation circular. A scoped `@vars` token reads exactly as
 * an unscoped one does, so binding those alone is a fixed point in one pass
 * and `goalBinderShadows` is empty by construction. That restriction doubles
 * as the worker's validation before it splices student-supplied text into
 * the theory ({@link checkPlaygroundGoal}): every binder must be a pool token
 * at its pool sort, and the statement must stay inside its math string.
 */

import type { ProofVariable } from "./formulas";
import {
  proofTheoryText,
  statementDisplayText,
  statementVariables,
  theoryVarsPools,
} from "./formulas";

/**
 * The theorem name every playground proof attaches to. Fixed, since the
 * `.auf` header and the declaration have to agree and nobody chooses it.
 */
export const PLAYGROUND_GOAL_NAME = "playground";

/** Generous cap on a statement; a proof line is a few hundred bytes. */
const MAX_STATEMENT_LENGTH = 8_192;

/** The goal a playground proof derived: what its answer carries. */
export interface PlaygroundGoal {
  /** The `@vars` tokens the statement holds, in first-occurrence order. */
  readonly binders: readonly ProofVariable[];
  /** The last line's `$ … $`, in engine text. */
  readonly statement: string;
}

/**
 * What a translator hands the playground: the last emitted line's math
 * string, and the variables its readings saw in it — `null` where the lines
 * were passed through as engine text and nothing looked.
 */
export interface ProofStatement {
  readonly text: string;
  readonly variables: readonly ProofVariable[] | null;
}

export function isPlaygroundGoal(value: unknown): value is PlaygroundGoal {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const goal = value as {
    readonly binders?: unknown;
    readonly statement?: unknown;
  };

  return (
    typeof goal.statement === "string" &&
    Array.isArray(goal.binders) &&
    goal.binders.every(
      (binder: unknown) =>
        typeof binder === "object" &&
        binder !== null &&
        typeof (binder as { name?: unknown }).name === "string" &&
        typeof (binder as { sort?: unknown }).sort === "string",
    )
  );
}

/**
 * The goal a proof's last statement makes, or `null` where its variables
 * cannot be found — a statement nobody read, over a theory that names no sort
 * to read it at.
 */
export function playgroundGoal(
  source: string | null | undefined,
  statement: ProofStatement,
): PlaygroundGoal | null {
  const binders =
    statement.variables ?? statementVariables(source, statement.text);

  return binders === null ? null : { binders, statement: statement.text };
}

/**
 * The declaration a goal becomes: `theorem playground {x: var} {a: name}: $ …
 * $;`. Every binder is a curly one at its pool sort — the shape the engine
 * accepts for a `name` as readily as a `var` — and no binder depends on
 * another, since none is a metavariable.
 */
export function playgroundDeclaration(goal: PlaygroundGoal): string {
  const binders = goal.binders
    .map((binder) => ` {${binder.name}: ${binder.sort}}`)
    .join("");

  return `theorem ${PLAYGROUND_GOAL_NAME}${binders}: $ ${goal.statement} $;`;
}

/**
 * The theory with the goal appended — the two texts an ordinary exercise's
 * join produces, built here from the answer instead of the artifact. Takes
 * the theory as `proofTheoryText` resolves it. The declaration is engine
 * text already, so both get the same one.
 */
export function playgroundTheoryText(
  theory: { readonly mm0: string; readonly source: string | null },
  goal: PlaygroundGoal,
): { readonly mm0: string; readonly source: string | null } {
  const declaration = playgroundDeclaration(goal);

  return {
    mm0: `${theory.mm0}\n${declaration}`,
    source:
      theory.source === null ? null : `${theory.source}\n${declaration}`,
  };
}

/** Why a submitted goal was refused; see {@link checkPlaygroundGoal}. */
export type PlaygroundGoalProblem =
  | "binder_not_in_pool"
  | "duplicate_binder"
  | "statement_escapes"
  | "statement_too_long"
  | "theory_unreadable";

/** `$`, which closes a math string, and the control characters. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point
const ESCAPES_MATH_STRING = /[$\x00-\x1f\x7f]/;

/**
 * Whether a submitted goal may be spliced into the theory, or why not.
 *
 * The worker's guard on the one place a submission's text enters the mm0.
 * The binders are checked against the theory's own `@vars` pools — a token
 * must be in the pool of the sort it claims — which is also the restriction
 * that keeps the derivation honest, so a client that derives correctly never
 * trips it. The statement is refused if it could leave its math string (`$`)
 * or break the line (`--` is a token inside `$ … $`, not a comment, so only
 * the delimiter and control characters can); anything else it says, the
 * engine parses and the certificate has to prove.
 */
export function checkPlaygroundGoal(
  source: string | null | undefined,
  goal: PlaygroundGoal,
): PlaygroundGoalProblem | null {
  const pools = theoryVarsPools(source);

  if (pools === null) {
    return "theory_unreadable";
  }

  const seen = new Set<string>();

  for (const binder of goal.binders) {
    if (seen.has(binder.name)) {
      return "duplicate_binder";
    }
    seen.add(binder.name);

    if (!(pools.get(binder.sort)?.has(binder.name) ?? false)) {
      return "binder_not_in_pool";
    }
  }

  if (goal.statement.length > MAX_STATEMENT_LENGTH) {
    return "statement_too_long";
  }

  if (ESCAPES_MATH_STRING.test(goal.statement)) {
    return "statement_escapes";
  }

  return null;
}

/** Whether a proof exercise's `publicData` marks it a playground. */
export function isPlaygroundExercise(publicData: unknown): boolean {
  return (
    typeof publicData === "object" &&
    publicData !== null &&
    (publicData as { readonly playground?: unknown }).playground === true
  );
}

/** The goal a stored answer's data carries, if it carries one. */
export function answerGoal(data: unknown): PlaygroundGoal | undefined {
  const goal =
    typeof data === "object" && data !== null
      ? (data as { readonly goal?: unknown }).goal
      : undefined;

  return isPlaygroundGoal(goal) ? goal : undefined;
}

/** What a certificate is verified against, or why a playground's cannot be. */
export type VerificationText =
  | { readonly ok: true; readonly mm0: string }
  | {
      readonly ok: false;
      readonly problem: PlaygroundGoalProblem | "missing_goal";
    };

/**
 * The mm0 a submission's certificate is verified against: the frozen text
 * for an ordinary exercise, and for a playground that text plus the goal the
 * answer derived — after {@link checkPlaygroundGoal} has let it in. The four
 * proof types' `evaluate` all go through here, so a playground that arrives
 * with no goal, or a goal the theory cannot vouch for, is refused in one
 * place, as `invalid` rather than as a failed verification.
 */
export function verificationText(
  publicData: {
    readonly mm0?: string;
    readonly playground?: boolean;
    readonly source?: string;
  },
  answerData: unknown,
): VerificationText {
  if (!isPlaygroundExercise(publicData)) {
    return { mm0: proofTheoryText(publicData).mm0, ok: true };
  }

  const goal = answerGoal(answerData);

  if (goal === undefined) {
    return { ok: false, problem: "missing_goal" };
  }

  const theory = proofTheoryText(publicData);
  const problem = checkPlaygroundGoal(theory.source, goal);

  return problem === null
    ? { mm0: playgroundTheoryText(theory, goal).mm0, ok: true }
    : { ok: false, problem };
}

/**
 * The goal as a reader should see it: the theory's own display spelling with
 * the sequent spaced, falling back to the engine text where the language
 * has no display conventions to read it back into (a theory that names no
 * sort for the shape).
 */
export function playgroundGoalText(
  source: string | null | undefined,
  goal: PlaygroundGoal,
): string {
  return (
    statementDisplayText(source, goal.statement, goal.binders) ??
    goal.statement
  );
}

/**
 * The last proof line's math string in a `.auf` body, or `null` when the text
 * has no line of the shape `label: $ … $ by …`. What the linear widget, whose
 * student writes the `.auf` by hand, derives its statement from; the shaped
 * widgets get theirs from their translators.
 */
export function lastProofStatement(body: string): string | null {
  const lines = body.split("\n");

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = /^\s*[A-Za-z_][A-Za-z0-9_']*\s*:\s*\$([^$]*)\$/.exec(
      lines[index] ?? "",
    );

    if (match !== null) {
      return (match[1] ?? "").trim();
    }
  }

  return null;
}
