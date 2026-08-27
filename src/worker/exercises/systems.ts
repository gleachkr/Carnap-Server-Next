/**
 * The document's systems table: one frozen copy of each MM0 artifact its
 * exercises are set in, and the join that hands that copy to an exercise.
 *
 * **Why a table rather than a copy per exercise.** A theory is frozen when a
 * lesson compiles — proof grading is `verifyMmb(certificate, mm0)`, so
 * re-resolving a shipped theory at grade time would re-grade stored proofs
 * every time one of those files was edited — and freezing is not in question.
 * What was wrong is that each exercise froze its *own* copy:
 * `forallx-calgary-2019.mm0` is 30 KB, so a lesson setting thirty proofs from
 * it stored thirty copies and sent thirty copies to the browser, one inside
 * every widget's hydration payload. Keying the text by name and storing it
 * once per document costs the same safety and none of the duplication.
 *
 * **What is stored is the key; what a consumer reads is the text.** The join
 * runs at each side's read boundary — {@link withSystemText} under
 * `parseContentArtifact` in the Worker, and under the client element base's
 * hydration read in the browser — so every consumer downstream of those two
 * points goes on taking a `publicData` alone. `resolveModel(publicData)`, the
 * proof widgets, the review renderers: none of them learns that a table
 * exists. The alternative, threading the table through `EvaluationContext` and
 * every review context, would have touched a dozen signatures to say the same
 * thing.
 *
 * The inverse, {@link keyedPublicData}, is what goes back on the wire.
 *
 * DOM-free and catalog-free: the browser runs this too.
 */

import { stripSyntaxAnnotations } from "@aufbau/syntax";
import type {
  CompiledContentArtifact,
  CompiledSystems,
  ContentNode,
} from "../domain/content";
import type { ExerciseManifestItem } from "../domain/exercises";
import type { JsonValue } from "../domain/json";

/** The fields the join fills in, which are the fields consumers read. */
interface SystemText {
  readonly mm0: string;
  readonly source: string;
}

/**
 * The two texts a system yields an exercise, given that exercise's own
 * declaration to append.
 *
 * The engine text is derived from the stored source by stripping rather than
 * stored beside it — `stripSyntaxAnnotations` drops whole lines, which is what
 * lets the declaration be appended before or after and give the same answer —
 * so a system costs one copy in the table, not two.
 *
 * Both fields always arrive, and that is deliberate: the three shaped proof
 * types read `source` through `proofTheoryText` and get surface formulas, while
 * the plain `aufbau-proof` type reads `mm0` and goes on being written in engine
 * text. Which text an exercise is at is a fact about its *type*, not about its
 * theory, and this is where the two stopped being conflated. A theory that is
 * no language costs the duplicate and nothing else: with no `@syntax` to strip
 * the two are the same bytes, and every reader that could care re-asks the spec
 * rather than trusting a field's absence.
 */
function systemText(source: string, declaration: string): SystemText {
  const suffix = declaration.length === 0 ? "" : `\n${declaration}`;

  return {
    mm0: `${stripSyntaxAnnotations(source)}${suffix}`,
    source: `${source}${suffix}`,
  };
}

/** What an exercise's `publicData` says about the system it is set in. */
interface KeyedData {
  readonly goalDecl?: unknown;
  readonly system?: unknown;
}

function keyOf(publicData: JsonValue): string | null {
  if (typeof publicData !== "object" || publicData === null) {
    return null;
  }

  const system = (publicData as KeyedData).system;

  return typeof system === "string" ? system : null;
}

/**
 * One exercise's `publicData` with its system's text filled in.
 *
 * Three things pass through untouched, and all three are ordinary rather than
 * exceptional: a payload with no `system` at all (every artifact compiled
 * before this table existed froze its text inline, and still carries it), one
 * whose key names nothing in the table, and one belonging to a type that is
 * set in no system.
 */
export function withSystemText(
  publicData: JsonValue,
  systems: CompiledSystems | undefined,
): JsonValue {
  const key = keyOf(publicData);
  const source = key === null ? undefined : systems?.[key];

  if (source === undefined) {
    return publicData;
  }

  const declaration = (publicData as KeyedData).goalDecl;

  return {
    ...(publicData as Record<string, JsonValue>),
    ...systemText(source, typeof declaration === "string" ? declaration : ""),
  };
}

/**
 * The inverse: `publicData` as it goes on the wire and into the database.
 *
 * A payload carrying a key needs neither text, because the reader on the other
 * side has the table and does the join itself. Dropping them here rather than
 * at each emitter is what keeps the saving from being accidental — every
 * hydration payload goes through one function (`exerciseHydrationScript` and
 * its preview-table sibling), and this is called from there.
 *
 * A payload with no key is left exactly as it is: it froze its own text, that
 * text is the only copy, and dropping it would empty the widget.
 */
export function keyedPublicData(publicData: JsonValue): JsonValue {
  if (keyOf(publicData) === null) {
    return publicData;
  }

  const {
    mm0: _mm0,
    source: _source,
    ...rest
  } = publicData as Record<string, JsonValue>;

  return rest;
}

/**
 * A whole artifact with every exercise's system text taken back out — the form
 * it is stored in.
 *
 * The compiler produces the joined form, because a compiled artifact is usually
 * about to be rendered and every consumer of one wants the text. This is the
 * single point where it stops being that: `ContentService.createRevision`, on
 * its way into the `compiled` column. A lesson of thirty proofs over one theory
 * stores one copy of it rather than thirty, and {@link withSystemSources} at
 * the read boundary puts the copies back.
 */
export function keyedArtifact(
  artifact: CompiledContentArtifact,
): CompiledContentArtifact {
  if (artifact.systems === undefined) {
    return artifact;
  }

  const nodes: ContentNode[] = artifact.document.nodes.map((node) =>
    node.kind === "exercise"
      ? { ...node, publicData: keyedPublicData(node.publicData) }
      : node,
  );

  const manifest: ExerciseManifestItem[] = artifact.manifest.map((item) => ({
    ...item,
    publicData: keyedPublicData(item.publicData),
  }));

  return {
    ...artifact,
    document: { ...artifact.document, nodes },
    manifest,
  };
}

/**
 * A whole artifact with every exercise's system text filled in — the join, at
 * the Worker's read boundary.
 *
 * Both halves are walked. The manifest is what grading and review read
 * (`declaration.publicData`), the document nodes are what the server renderers
 * read, and an exercise that resolved in one place and not the other would be
 * a widget that grades but will not draw.
 *
 * Returns the artifact unchanged, identity included, when there is no table to
 * join — which is every artifact stored before this existed, and every lesson
 * with no formulas in it.
 */
export function withSystemSources(
  artifact: CompiledContentArtifact,
): CompiledContentArtifact {
  const systems = artifact.systems;

  if (systems === undefined || Object.keys(systems).length === 0) {
    return artifact;
  }

  const nodes: ContentNode[] = artifact.document.nodes.map((node) =>
    node.kind === "exercise"
      ? { ...node, publicData: withSystemText(node.publicData, systems) }
      : node,
  );

  const manifest: ExerciseManifestItem[] = artifact.manifest.map((item) => ({
    ...item,
    publicData: withSystemText(item.publicData, systems),
  }));

  return {
    ...artifact,
    document: { ...artifact.document, nodes },
    manifest,
  };
}
