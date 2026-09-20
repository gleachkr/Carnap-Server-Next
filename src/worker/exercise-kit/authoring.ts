import {
  type CompilerDiagnostic,
  diagnostic,
} from "../application/content/diagnostics";
import { sha256Id, stableJson } from "../application/content/hash";
import type { MarkdownNode } from "../application/content/markdown";
import type {
  ContentNode,
  ExerciseCapabilities,
  ExerciseFeedback,
  ExerciseKind,
  ExerciseManifestItem,
  ExerciseRenderSpec,
} from "../domain/content";
import type { JsonValue } from "../domain/json";

/**
 * What every exercise type's `authoring.ts` is built from: the directive block
 * the compiler hands it, the attribute parsers the common attributes share,
 * and the declaration/manifest assembly that turns a type's compiled data into
 * a manifest item and a document node. The authoring twin of `assessment.ts`.
 *
 * The compiler (`application/content/compiler.ts`) is the other party to
 * these shapes: it cuts a {@link DirectiveBlock} out of the Markdown tree and
 * takes a {@link CompiledExercise} back. The Markdown pipeline itself — the
 * parser, the sanitizer, the prompt renderers — stays with the application in
 * `markdown.ts`; a type imports both, and this module reads only the
 * tree's node type from there.
 */

export interface DirectiveBlock {
  readonly attrs: Record<string, string>;
  readonly bodyLines: readonly string[];
  readonly bodyStartLine: number;
  readonly children: readonly MarkdownNode[];
  readonly line: number;
  readonly name: string;
}

/** The compiled output for one exercise directive. */
export interface CompiledExercise {
  readonly manifestItem: ExerciseManifestItem;
  readonly node: ContentNode;
}

/**
 * What an exercise ID may be: an HTML id, bounded in length.
 *
 * HTML's own rule is "not empty and no ASCII whitespace", and that is very
 * nearly this one. An id reaches the page only as `data-exercise-id="…"` and,
 * for the two server-rendered answer forms, as an HTML `id`/`for` pair — none
 * of which needs a character class narrower than the one HTML already gives.
 * A tighter rule than that would only be refusing `ex1.2` to no purpose, which
 * is what this used to do.
 *
 * Excluded past HTML's rule, all for the same reason — an id that cannot be
 * seen cannot be typed back or told apart: whitespace of every kind rather than
 * just ASCII's, so a non-breaking space is not an invisible difference between
 * two ids; control characters; and format characters, which include the bidi
 * overrides that would let one id render as another.
 *
 * A dotted id has to be written `id="ex1.2"`. The `#` shorthand cannot spell
 * one, because `.` opens a class there — see `docs/carnap-markdown-v1.md`.
 */
export const EXERCISE_ID_PATTERN = /^[^\s\p{Cc}\p{Cf}]{1,64}$/u;

export function requireAttribute(
  block: DirectiveBlock,
  name: string,
  diagnostics: CompilerDiagnostic[],
): string | null {
  const value = block.attrs[name];

  if (value === undefined || value.trim().length === 0) {
    diagnostics.push(
      diagnostic(
        block.line,
        `missing_${name}`,
        "The {name} attribute is required.",
        {
          params: { name },
        },
      ),
    );

    return null;
  }

  return value.trim();
}

export function parsePoints(
  value: string | undefined,
  line: number,
  diagnostics: CompilerDiagnostic[],
): number {
  if (value === undefined) {
    return 1;
  }

  const points = Number(value);

  if (!Number.isFinite(points) || points <= 0 || points > 1000) {
    diagnostics.push(
      diagnostic(
        line,
        "invalid_points",
        "Exercise points must be a positive number no greater than 1000.",
      ),
    );

    return 1;
  }

  return points;
}

export function parseBooleanAttribute(
  value: string | undefined,
  line: number,
  name: string,
  diagnostics: CompilerDiagnostic[],
): boolean {
  if (value === undefined || value === "false") {
    return false;
  }

  // A bare attribute ({exam}) parses as an empty string: presence means true.
  if (value === "" || value === "true") {
    return true;
  }

  diagnostics.push(
    diagnostic(
      line,
      `invalid_${name.replaceAll("-", "_")}`,
      "The {name} attribute must be true or false.",
      { params: { name } },
    ),
  );

  return false;
}

/**
 * Read `exam=`, or `undefined` when the author did not say.
 *
 * Its own parser rather than {@link parseBooleanAttribute} because the absence
 * carries information that a plain boolean cannot hold. An assignment holding
 * its grades back keeps every submission and an assignment that has released
 * them keeps only correct ones, so "no instruction" is a third value and
 * `resolveExerciseExam` settles it where the assignment is known. Collapsing it
 * to `false` here is what made `exam="false"` a no-op — indistinguishable from
 * writing nothing, in a place where the two now mean different things.
 *
 * Same vocabulary and same diagnostic as the plain parser: a bare `{exam}` is
 * presence, and therefore true.
 */
export function parseExamAttribute(
  value: string | undefined,
  line: number,
  diagnostics: CompilerDiagnostic[],
): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  return parseBooleanAttribute(value, line, "exam", diagnostics);
}

/**
 * Read `feedback=`, or `undefined` when the author did not say.
 *
 * The absence is kept rather than defaulted here because the default is not a
 * property of the exercise: an assignment holding its grades back says nothing
 * and one that has released them says everything, and one compiled artifact
 * serves both. `resolveExerciseFeedback` settles it at render and submit time,
 * where the assignment is known.
 *
 * A bare `{feedback}` is refused along with everything else that is not one of
 * the three words — unlike `exam`, whose presence plainly means true, "some
 * feedback" is not an amount.
 */
export function parseFeedbackAttribute(
  block: DirectiveBlock,
  diagnostics: CompilerDiagnostic[],
): ExerciseFeedback | undefined {
  const value = block.attrs.feedback;

  if (value === undefined) {
    return undefined;
  }

  if (value !== "full" && value !== "terse" && value !== "none") {
    diagnostics.push(
      diagnostic(
        block.line,
        "invalid_feedback",
        "The feedback attribute must be full, terse, or none.",
      ),
    );

    return undefined;
  }

  return value;
}

/**
 * Reconcile a type's own `check=` spelling with the shared `feedback=`.
 *
 * The truth table and the model each shipped a per-type knob for this before
 * there was a cross-type one — `check="cells|terse|off"` and `check="on|off"`,
 * both mirroring Carnap's `nocheck`. They keep working, so ported content does
 * not churn, but they are now two spellings of one setting and an author who
 * writes both has said one thing twice and possibly disagreed with themselves.
 *
 * `fromCheck` is what the type's own attribute worked out to, or `undefined`
 * when the author wrote neither it nor the flag — which is the distinction that
 * matters: an unwritten `check` must not read as an explicit request for full
 * detail, or it would override the `exam` default for every exercise ever
 * written.
 */
export function reconcileFeedback(
  block: DirectiveBlock,
  fromCheck: ExerciseFeedback | undefined,
  diagnostics: CompilerDiagnostic[],
): ExerciseFeedback | undefined {
  const feedback = parseFeedbackAttribute(block, diagnostics);

  if (feedback === undefined) {
    return fromCheck;
  }

  if (fromCheck !== undefined) {
    diagnostics.push(
      diagnostic(
        block.line,
        "redundant_check_attribute",
        "The check and feedback attributes say the same thing; keep feedback and drop check.",
      ),
    );
  }

  return feedback;
}

/**
 * The attributes every exercise directive takes, whatever its type.
 *
 * `id` is spelled `#id` in the source; `title` and `points` are the manifest's;
 * `exam` decides whether wrong work is recorded and `feedback` how much of the
 * verdict comes back. A type adds its own on top — see
 * {@link validateAttributes}.
 */
export const COMMON_EXERCISE_ATTRIBUTES = [
  "exam",
  "feedback",
  "id",
  "points",
  "title",
] as const;

/**
 * Reject an attribute the directive does not understand.
 *
 * Until this existed, an attribute nobody read was simply dropped: an author
 * could write `feedback="none"` on a proof exercise, or misspell `exam` as
 * `exm`, and the revision saved clean. The second is the one that bites — `exam`
 * decides whether a wrong answer is recorded at all, so a typo silently turns a
 * summative exercise back into a practice one and nothing on the page says so.
 * Silently discarding an instruction is the worst of the three options; the
 * other two are obeying it and saying you can't.
 *
 * It is a hard error rather than a warning, though the severity channel
 * exists (`diagnostics.ts`, and `compileCarnapMarkdown` fails the compile only
 * on an error): a warning is for something the author may legitimately want,
 * and an attribute nothing reads is never that. The cost is real and
 * accepted: a stored revision carrying a stray attribute will refuse to re-save
 * until its author deletes it.
 *
 * The message names the accepted set, because "unknown attribute" without it
 * leaves an author guessing at a spelling — the shape `parseProofOptions`
 * already uses for `options=`.
 *
 * `accepted` is the whole list, not the per-type remainder: `aufbau-mm0` is a
 * directive without being an exercise, so it has none of
 * {@link COMMON_EXERCISE_ATTRIBUTES} and would have to opt out of a set it was
 * given implicitly. The exercise types spread the common ones in themselves.
 */
export function validateAttributes(
  block: DirectiveBlock,
  accepted: readonly string[],
  diagnostics: CompilerDiagnostic[],
): void {
  const known = new Set<string>(accepted);
  const listed = [...accepted].sort().join(", ");

  for (const name of Object.keys(block.attrs)) {
    if (known.has(name)) {
      continue;
    }

    diagnostics.push(
      diagnostic(
        block.line,
        "unknown_attribute",
        "Unknown attribute “{name}”. This directive accepts: {accepted}.",
        { params: { accepted: listed, name } },
      ),
    );
  }
}

export function validateExerciseId(
  block: DirectiveBlock,
  id: string,
  diagnostics: CompilerDiagnostic[],
): void {
  if (!EXERCISE_ID_PATTERN.test(id)) {
    diagnostics.push(
      diagnostic(
        block.line,
        "invalid_exercise_id",
        "Exercise IDs must be 1 to 64 characters long and contain no spaces.",
      ),
    );
  }
}

/**
 * Assemble the shared declaration, manifest item, and content node for one
 * exercise. The declaration (which is hashed) deliberately omits `capabilities`
 * and only carries `exam` and `feedback` when set, so existing content keeps its
 * recorded declaration hashes; the title is normalized to `null` when empty
 * there and omitted from the manifest item.
 */
export async function buildCompiledExercise(input: {
  readonly answerKind: string;
  readonly capabilities: ExerciseCapabilities;
  readonly exam: boolean | undefined;
  readonly feedback: ExerciseFeedback | undefined;
  readonly id: string;
  readonly kind: ExerciseKind;
  readonly nominalPoints: number;
  readonly privateData: unknown;
  readonly publicData: unknown;
  readonly render: ExerciseRenderSpec;
  readonly schemaVersion: number;
  readonly title: string | undefined;
}): Promise<CompiledExercise> {
  const hasTitle = input.title !== undefined && input.title.length > 0;
  // Absent unless the author said, like `feedback` below — so content written
  // before either attribute existed still hashes to what the database recorded.
  // The `false` is carried, though: it is now a different instruction from
  // silence, and an exercise that spells it out gets a new hash on next save.
  const examFields = input.exam === undefined ? {} : { exam: input.exam };
  // Absent unless the author said, so every declaration hash written before
  // `feedback` existed still hashes to what the database recorded.
  const feedbackFields =
    input.feedback === undefined ? {} : { feedback: input.feedback };
  const declaration = {
    answerKind: input.answerKind,
    ...examFields,
    ...feedbackFields,
    id: input.id,
    kind: input.kind,
    nominalPoints: input.nominalPoints,
    privateData: input.privateData,
    publicData: input.publicData,
    render: input.render,
    schemaVersion: input.schemaVersion,
    title: hasTitle ? (input.title as string) : null,
  };
  const manifestItem: ExerciseManifestItem = {
    answerKind: input.answerKind,
    capabilities: input.capabilities,
    declarationHash: await sha256Id(stableJson(declaration)),
    ...examFields,
    ...feedbackFields,
    id: input.id,
    kind: input.kind,
    nominalPoints: input.nominalPoints,
    privateData: input.privateData as JsonValue,
    publicData: input.publicData as JsonValue,
    render: input.render,
    schemaVersion: input.schemaVersion,
    ...(hasTitle ? { title: input.title as string } : {}),
  };
  const node: ContentNode = {
    exerciseId: input.id,
    exerciseKind: input.kind,
    kind: "exercise",
    publicData: input.publicData as JsonValue,
    render: input.render,
  };

  return { manifestItem, node };
}
