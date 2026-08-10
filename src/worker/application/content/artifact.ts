import type {
  CompiledContentArtifact,
  ContentRevision,
} from "../../domain/content";
import type { JsonValue } from "../../domain/json";
import { deferred } from "../../i18n/deferred";
import type { Translator } from "../../i18n/translator";
import { AppHttpError } from "../errors";

/**
 * A stored artifact that cannot be read, with the diagnosis attached.
 *
 * The two messages say different things on purpose, and this is the one error
 * class where that difference is the point. `Error.message` — what the JSON
 * envelope and the log line carry — names the revision and the defect, because
 * the only people who can act on this are the author who can save the source
 * again and the operator reading the log, and neither can act on "something
 * went wrong". {@link localize} is a sentence for whoever happened to open the
 * page, in their language, with no identifiers in it.
 *
 * That is why the diagnosis is a plain literal rather than a {@link deferred}
 * message, and so why this class is absent from the constructor table in
 * `tests/error-messages.test.ts`: the literal is not prose a reader is shown.
 * The prose a reader is shown is the override, and that test pins it.
 */
export class ContentArtifactError extends AppHttpError {
  constructor(
    readonly revisionId: string,
    /** English, for an operator: what about the artifact could not be read. */
    readonly defect: string,
  ) {
    super(
      500,
      "invalid_content_artifact",
      `Content revision ${revisionId} holds an unreadable artifact: ${defect}`,
    );
    this.name = "ContentArtifactError";
  }

  override localize(i18n: Translator): string {
    return i18n.t(
      "This content could not be read. Its saved form does not match what the compiler produces — saving the source again should repair it.",
    );
  }
}

function unreadable(revisionId: string, defect: string): never {
  throw new ContentArtifactError(revisionId, defect);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (Array.isArray(value)) {
    return "an array";
  }

  return value === null ? "null" : `a ${typeof value}`;
}

/**
 * Read a stored artifact, or say what is wrong with it.
 *
 * Every path that takes a `compiled` column out of the database and treats it
 * as a {@link CompiledContentArtifact} comes through here. Before this there
 * were four converters — two bare `as unknown as` casts and two that checked
 * only that `manifest` was an array — so one bad row was a silent cast on one
 * route, an anonymous 500 on another, and an unhandled `TypeError` on a third,
 * none of them naming the revision.
 *
 * What it checks is not the compiler's schema; it is the set of invariants
 * whose violation is a failure someone has actually had. Being stricter than
 * that would start rejecting artifacts that render perfectly well, which is a
 * migration decision and does not belong at a read boundary.
 */
export function parseContentArtifact(
  compiled: JsonValue,
  revisionId: string,
): CompiledContentArtifact {
  if (!isObject(compiled)) {
    unreadable(revisionId, `the artifact is ${describe(compiled)}`);
  }

  const document = compiled.document;

  if (!isObject(document) || !Array.isArray(document.nodes)) {
    unreadable(revisionId, "`document.nodes` is missing or is not an array");
  }

  const manifest = compiled.manifest;

  if (!Array.isArray(manifest)) {
    unreadable(revisionId, "`manifest` is missing or is not an array");
  }

  const declared = new Set<string>();

  for (const [at, item] of manifest.entries()) {
    if (!isObject(item) || typeof item.id !== "string") {
      unreadable(revisionId, `manifest item ${at} has no string \`id\``);
    }

    // Not decoration: this number is summed into the `scoreMaximum` of the
    // gradebook column an LMS creates from a deep link, and into the
    // denominator every score is reported against. A missing one read as zero
    // for a while, which is indistinguishable from an ungraded exercise.
    if (!Number.isFinite(item.nominalPoints)) {
      unreadable(
        revisionId,
        `manifest item "${item.id}" has no numeric \`nominalPoints\``,
      );
    }

    declared.add(item.id);
  }

  for (const [at, node] of document.nodes.entries()) {
    if (!isObject(node) || typeof node.kind !== "string") {
      unreadable(revisionId, `document node ${at} has no string \`kind\``);
    }

    if (node.kind !== "exercise") {
      continue;
    }

    if (typeof node.exerciseId !== "string") {
      unreadable(
        revisionId,
        `exercise node ${at} has no string \`exerciseId\``,
      );
    }

    if (!isObject(node.render) || typeof node.render.assetId !== "string") {
      unreadable(revisionId, `exercise node ${at} has no \`render.assetId\``);
    }

    // The invariant that fails silently, and the reason this parse exists at
    // all rather than a `manifest`-is-an-array check. An exercise the manifest
    // does not declare still renders — the document node carries its own
    // markup — but nothing downstream knows it is there: it is worth no
    // points, and it asks for no client bundle, so the custom element never
    // upgrades and its inputs stay disabled. A reader gets a question they
    // cannot answer, with no error in the browser or the log. The compiler
    // emits the node and its manifest item together, so an artifact where the
    // two disagree was not written by the compiler.
    if (!declared.has(node.exerciseId)) {
      unreadable(
        revisionId,
        `exercise "${node.exerciseId}" is in the document but not in the manifest`,
      );
    }
  }

  if (compiled.css !== undefined && typeof compiled.css !== "string") {
    unreadable(revisionId, "`css` is present but is not a string");
  }

  if (
    compiled.cssHrefs !== undefined &&
    (!Array.isArray(compiled.cssHrefs) ||
      compiled.cssHrefs.some((href) => typeof href !== "string"))
  ) {
    unreadable(
      revisionId,
      "`cssHrefs` is present but is not an array of strings",
    );
  }

  if (
    compiled.cssReset !== undefined &&
    typeof compiled.cssReset !== "boolean"
  ) {
    unreadable(revisionId, "`cssReset` is present but is not a boolean");
  }

  return compiled as unknown as CompiledContentArtifact;
}

/** {@link parseContentArtifact} over a revision, which knows its own id. */
export function contentArtifactFromRevision(
  revision: ContentRevision,
): CompiledContentArtifact {
  return parseContentArtifact(revision.compiled, revision.id);
}
