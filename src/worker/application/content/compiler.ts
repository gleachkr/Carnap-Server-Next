import type { Root } from "mdast";
import type { ContainerDirective } from "mdast-util-directive";
import type {
  CompiledContentArtifact,
  ContentNode,
  ContentSourceProfile,
  ExerciseManifestItem,
} from "../../domain/content";
import { withSystemSources } from "../../exercise-kit/systems/join";
import type {
  AufbauTheory,
  SystemResolver,
} from "../../exercise-kit/systems/theory";
import {
  builtInSystem,
  compileAufbauMm0,
} from "../../exercise-kit/systems/theory";
import { compileAufbauProof } from "../../exercises/aufbau-proof/authoring";
import { AUFBAU_PROOF_KIND } from "../../exercises/aufbau-proof/types";
import { compileAufbauProofFitch } from "../../exercises/aufbau-proof-fitch/authoring";
import { AUFBAU_PROOF_FITCH_KIND } from "../../exercises/aufbau-proof-fitch/types";
import { compileAufbauProofPrawitz } from "../../exercises/aufbau-proof-prawitz/authoring";
import { AUFBAU_PROOF_PRAWITZ_KIND } from "../../exercises/aufbau-proof-prawitz/types";
import { compileAufbauProofTree } from "../../exercises/aufbau-proof-tree/authoring";
import { AUFBAU_PROOF_TREE_KIND } from "../../exercises/aufbau-proof-tree/types";
import { compileFreeResponse } from "../../exercises/free-response/authoring";
import { FREE_RESPONSE_KIND } from "../../exercises/free-response/types";
import {
  compileModel,
  modelDataBodyLines,
} from "../../exercises/model/authoring";
import { MODEL_KIND } from "../../exercises/model/types";
import { compileMultipleChoice } from "../../exercises/multiple-choice/authoring";
import { MULTIPLE_CHOICE_KIND } from "../../exercises/multiple-choice/types";
import { compileShortAnswer } from "../../exercises/short-answer/authoring";
import { SHORT_ANSWER_KIND } from "../../exercises/short-answer/types";
import { compileTranslation } from "../../exercises/translation/authoring";
import { TRANSLATION_KIND } from "../../exercises/translation/types";
import { compileTruthTable } from "../../exercises/truth-table/authoring";
import { TRUTH_TABLE_KIND } from "../../exercises/truth-table/types";
import type { TheoryResolver } from "../../logic/theories";
import { BUILT_IN_SYSTEM_IDS } from "../../logic/theories";
import type { AuthoringExerciseRegistry } from "./authoring-registry";
import { createDefaultAuthoringExerciseRegistry } from "./authoring-registry";
import type {
  CompilerDiagnostic,
  DirectiveBlock,
  MarkdownNode,
} from "./authoring-toolkit";
import {
  createFootnoteNumbering,
  diagnostic,
  directiveBlockFromNode,
  footnoteReferencesIn,
  isItemLinkTarget,
  isValidItemLinkTarget,
  markdownParser,
  renderMarkdownChildren,
} from "./authoring-toolkit";
import { createMathCompiler, type MathFailure } from "./math";

export type { CompilerDiagnostic } from "./authoring-toolkit";
export { CONTENT_SANITIZE_SCHEMA } from "./authoring-toolkit";

export type CompileMarkdownResult =
  | {
      readonly artifact: CompiledContentArtifact;
      readonly diagnostics: readonly CompilerDiagnostic[];
      readonly ok: true;
    }
  | {
      readonly diagnostics: readonly CompilerDiagnostic[];
      readonly ok: false;
    };

const PROFILE: ContentSourceProfile = "carnap-markdown-v1";
const MANIFEST_VERSION = 1;
const COMPONENT_REGISTRY_VERSION = "component-registry-v1";

function hasUnsafeHtml(value: string): boolean {
  return /<[A-Za-z!/?][^>]*>/.test(value);
}

const NO_EXCLUDED_LINES: ReadonlySet<number> = new Set();

function unsupportedRawHtmlDiagnostics(
  lines: readonly string[],
  startLine: number,
  excludedLines: ReadonlySet<number> = NO_EXCLUDED_LINES,
): CompilerDiagnostic[] {
  return lines.flatMap((line, index) =>
    !excludedLines.has(startLine + index) && hasUnsafeHtml(line)
      ? [
          diagnostic(
            startLine + index,
            "unsafe_raw_html",
            "Raw HTML is not allowed in carnap-markdown-v1.",
          ),
        ]
      : [],
  );
}

function legacyDirectiveSyntaxDiagnostics(
  lines: readonly string[],
  startLine: number,
  excludedLines: ReadonlySet<number> = NO_EXCLUDED_LINES,
): CompilerDiagnostic[] {
  return lines.flatMap((line, index) =>
    !excludedLines.has(startLine + index) &&
    /^:{3,}[A-Za-z][A-Za-z0-9_-]*\s+/.test(line.trim())
      ? [
          diagnostic(
            startLine + index,
            "invalid_directive_attributes",
            "Directive attributes must use standard directive syntax.",
          ),
        ]
      : [],
  );
}

function isContainerDirective(
  node: MarkdownNode,
): node is ContainerDirective {
  return node.type === "containerDirective";
}

const STYLE_DIRECTIVE_NAME = "style";

function isStyleDirective(node: MarkdownNode): node is ContainerDirective {
  return isContainerDirective(node) && node.name === STYLE_DIRECTIVE_NAME;
}

const AUFBAU_MM0_DIRECTIVE_NAME = "aufbau-mm0";

function isAufbauMm0Directive(
  node: MarkdownNode,
): node is ContainerDirective {
  return (
    isContainerDirective(node) && node.name === AUFBAU_MM0_DIRECTIVE_NAME
  );
}

// The Fitch and Prawitz starter bodies are raw proof text, not markdown: the
// Fitch `:<rule>` justifications and the Prawitz `-- label:n` comments parse
// as inline directives, and formulas may contain `<`, so — like
// `:::aufbau-mm0` — their bodies are kept out of the raw-HTML/nested-directive
// scans and handed to the type verbatim.
const RAW_BODY_PROOF_DIRECTIVE_NAMES: ReadonlySet<string> = new Set([
  "aufbau-proof-fitch",
  "aufbau-proof-prawitz",
]);

const MODEL_DIRECTIVE_NAME = "model";

function isRawBodyProofDirective(
  node: MarkdownNode,
): node is ContainerDirective {
  return (
    isContainerDirective(node) &&
    RAW_BODY_PROOF_DIRECTIVE_NAMES.has(node.name)
  );
}

/**
 * A stylesheet link target: an absolute https URL or a site-relative path
 * (for stylesheets this site serves). A single leading slash only —
 * protocol-relative `//host` targets are rejected, as is any other scheme.
 */
function isValidStylesheetHref(value: string): boolean {
  if (value.startsWith("/")) {
    return !value.startsWith("//");
  }

  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Line numbers occupied by the bodies of top-level directives whose bodies are
 * raw source, not markdown: `:::style` (CSS like `content: "<b>"`) and
 * `:::aufbau-mm0` (MM0 notation like `$<->$`). The raw-HTML and legacy-syntax
 * line scans must not read them.
 */
function rawDirectiveBodyLines(tree: Root): ReadonlySet<number> {
  const excluded = new Set<number>();

  for (const child of tree.children as MarkdownNode[]) {
    if (
      (!isStyleDirective(child) &&
        !isAufbauMm0Directive(child) &&
        !isRawBodyProofDirective(child)) ||
      child.position === undefined
    ) {
      continue;
    }

    for (
      let line = child.position.start.line + 1;
      line < child.position.end.line;
      line += 1
    ) {
      excluded.add(line);
    }
  }

  return excluded;
}

function isDirectiveNode(node: { readonly type?: string }): boolean {
  return (
    node.type === "containerDirective" ||
    node.type === "leafDirective" ||
    node.type === "textDirective"
  );
}

/**
 * The body lines a directive reads as data rather than markdown, and so the
 * lines on which a stray `:token` is not a nested directive the author meant.
 *
 * Deliberately not the same set as {@link rawDirectiveBodyLines}, which serves
 * the raw-HTML and legacy-syntax *line* scans: a model is here and not there,
 * because its prompt is prose and raw HTML written in it is still a mistake.
 * Which is also why this is per line rather than per directive — a model's body
 * is only partly data, and a nested directive in its prompt is worth reporting.
 */
function dataBodyLines(block: DirectiveBlock): ReadonlySet<number> {
  if (RAW_BODY_PROOF_DIRECTIVE_NAMES.has(block.name)) {
    return new Set(
      block.bodyLines.map((_line, index) => block.bodyStartLine + index),
    );
  }

  if (block.name === MODEL_DIRECTIVE_NAME) {
    return modelDataBodyLines(block);
  }

  return NO_EXCLUDED_LINES;
}

function collectNestedDirectiveDiagnostics(
  node: unknown,
  diagnostics: CompilerDiagnostic[],
  dataLines: ReadonlySet<number> = NO_EXCLUDED_LINES,
): void {
  if (typeof node !== "object" || node === null) {
    return;
  }

  const candidate = node as {
    readonly children?: readonly unknown[];
    readonly name?: string;
    readonly position?: {
      readonly start?: { readonly line?: number };
    };
    readonly type?: string;
  };

  const line = candidate.position?.start?.line ?? 1;

  if (isDirectiveNode(candidate) && !dataLines.has(line)) {
    diagnostics.push(
      diagnostic(
        line,
        "unsupported_directive",
        "Directive {name} is not supported here.",
        { params: { name: candidate.name ?? "unknown" } },
      ),
    );
  }

  // Descended into whatever the node is: a raw line is often a lazy
  // continuation of a paragraph that began on a prose line, so a node's own
  // position is the only one that says which line it was written on.
  for (const child of candidate.children ?? []) {
    collectNestedDirectiveDiagnostics(child, diagnostics, dataLines);
  }
}

/**
 * Diagnostics for `item:` links whose remainder is not a plausible content
 * item ID. Walks the parsed tree (including exercise directive bodies) so
 * positions point at the source; style directive children are skipped by the
 * caller because their bodies are raw CSS.
 */
function collectInvalidItemLinkDiagnostics(
  node: unknown,
  diagnostics: CompilerDiagnostic[],
): void {
  if (typeof node !== "object" || node === null) {
    return;
  }

  const candidate = node as {
    readonly children?: readonly unknown[];
    readonly position?: {
      readonly start?: { readonly line?: number };
    };
    readonly type?: string;
    readonly url?: string;
  };

  if (
    candidate.type === "link" &&
    candidate.url !== undefined &&
    isItemLinkTarget(candidate.url) &&
    !isValidItemLinkTarget(candidate.url)
  ) {
    diagnostics.push(
      diagnostic(
        candidate.position?.start?.line ?? 1,
        "invalid_item_link",
        "Item links must look like item:<content-item-id>.",
      ),
    );
  }

  for (const child of candidate.children ?? []) {
    collectInvalidItemLinkDiagnostics(child, diagnostics);
  }
}

/**
 * A formula that would not typeset, as a complaint the author can act on.
 *
 * Failing the save is the point. MathJax's own habit is to render an unparseable
 * formula as an `<merror>` box and carry on, which would store the words
 * "Undefined control sequence" in the artifact and leave a student to discover
 * them; an author watching the preview finds out instead, next to the line.
 */
/**
 * The same resolver, asked at most once per path. Undefined in, undefined out:
 * a caller with nothing to resolve with should not acquire a cache.
 */
function memoizeTheoryResolver(
  resolve: TheoryResolver | undefined,
): TheoryResolver | undefined {
  if (resolve === undefined) {
    return undefined;
  }

  // The promise, not the result: two blocks naming one path in the same
  // document should share a single read rather than start a second one while
  // the first is still in flight.
  const answers = new Map<string, Promise<string | null>>();

  return (path) => {
    const asked = answers.get(path);

    if (asked !== undefined) {
      return asked;
    }

    const answer = resolve(path);
    answers.set(path, answer);

    return answer;
  };
}

function mathDiagnostic(failure: MathFailure): CompilerDiagnostic {
  return diagnostic(
    failure.line,
    "invalid_math",
    "This formula could not be typeset: {detail}",
    {
      column: failure.column,
      params: { detail: failure.detail },
    },
  );
}

/**
 * The resolver every exercise's `system=` goes through: a block this document
 * declares, then an id the server ships.
 *
 * A block wins, which is what lets a course extend forallx and go on calling
 * the result `forallx`. A shipped id that *is* named is entered into the same
 * map, so it lands in the systems table below on exactly the terms a block
 * does — one frozen copy per document either way — and so the second exercise
 * naming it reads the same object as the first.
 *
 * The miss names both namespaces. It has to: a mistyped block name falls
 * through to the id lookup, and a message that listed only the shipped ids
 * would answer a question the author did not ask.
 */
function systemResolver(theories: Map<string, AufbauTheory>): SystemResolver {
  return (name, line, diagnostics) => {
    const known = theories.get(name) ?? builtInSystem(name);

    if (known !== null && known !== undefined) {
      theories.set(name, known);

      return known;
    }

    const declared = [...theories.keys()].sort();

    diagnostics.push(
      diagnostic(
        line,
        "unknown_system",
        declared.length === 0
          ? "No system named “{name}” is in scope. This document declares no aufbau-mm0 block, and this site ships: {available}."
          : "No system named “{name}” is in scope. This document declares: {declared}. This site ships: {available}.",
        {
          params: {
            available: BUILT_IN_SYSTEM_IDS.join(", "),
            declared: declared.join(", "),
            name,
          },
        },
      ),
    );

    return null;
  };
}

/**
 * The document's systems table: one frozen copy of each theory its exercises
 * actually name.
 *
 * Read off the manifest rather than tracked as the blocks compile, because the
 * manifest is where the keys are — an exercise wrote one, so an exercise is
 * what asks for the text. A theory declared and never used is left out; the
 * copy that a `show` panel needs is already in its own node.
 */
function referencedSystems(
  theories: ReadonlyMap<string, AufbauTheory>,
  manifest: readonly ExerciseManifestItem[],
): Record<string, string> {
  const systems: Record<string, string> = {};

  for (const item of manifest) {
    const data = item.publicData;

    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      continue;
    }

    const name = (data as { readonly system?: unknown }).system;

    if (typeof name !== "string") {
      continue;
    }

    const theory = theories.get(name);

    if (theory !== undefined) {
      // As written. The engine text is one strip away and every reader that
      // wants it does that strip; freezing it here instead would be the only
      // point in the pipeline where an author's `@syntax` could be lost.
      systems[name] = theory.source;
    }
  }

  return systems;
}

/**
 * What a caller can lend the compiler beyond the source text.
 *
 * Both are optional, and the defaults are what makes this compiler runnable
 * anywhere: with neither, a document compiles from the module graph alone —
 * no database, no network — which is what `bun test`, the demo scripts and the
 * verify scripts rely on, and what the browser preview relied on entirely
 * until theories could be hosted.
 */
export interface CompileMarkdownOptions {
  readonly authoringRegistry?: AuthoringExerciseRegistry;
  /**
   * How a `src=` this site serves from the *database* is answered — the
   * instructor-hosted half of the theory URL namespace. Built-ins never reach
   * it. Omitted by every caller that has no way to read one, which is not a
   * degraded mode: it is a compiler that knows about the shipped theories and
   * nothing else, and it says so in the diagnostic.
   */
  readonly resolveTheory?: TheoryResolver;
}

export async function compileCarnapMarkdown(
  sourceText: string,
  options: CompileMarkdownOptions = {},
): Promise<CompileMarkdownResult> {
  const authoringRegistry =
    options.authoringRegistry ?? createDefaultAuthoringExerciseRegistry();
  // One read per path per document. A lesson naming its course's theory in
  // five blocks is the ordinary shape, and each of those blocks would
  // otherwise be its own database round trip for bytes that cannot have
  // changed since the first.
  const resolveTheory = memoizeTheoryResolver(options.resolveTheory);
  const normalizedSource = sourceText.replaceAll("\r\n", "\n");
  const lines = normalizedSource.split("\n");
  const tree = markdownParser.parse(normalizedSource) as Root;
  const excludedLines = rawDirectiveBodyLines(tree);
  const diagnostics: CompilerDiagnostic[] = [
    ...unsupportedRawHtmlDiagnostics(lines, 1, excludedLines),
    ...legacyDirectiveSyntaxDiagnostics(lines, 1, excludedLines),
  ];
  const nodes: ContentNode[] = [];
  const manifest: ExerciseManifestItem[] = [];
  const exerciseIds = new Set<string>();
  // Every system this document's exercises can name: the `:::aufbau-mm0` blocks
  // it declares, plus the shipped ids any exercise asks for, entered as they
  // are asked for. `referencedSystems` freezes the ones that were used.
  const theories = new Map<string, AufbauTheory>();
  const resolveSystem = systemResolver(theories);
  const cssParts: string[] = [];
  const cssHrefs: string[] = [];
  let cssReset = false;
  let markdownChildren: MarkdownNode[] = [];
  // Footnote definitions, held aside until a run of prose asks for one.
  //
  // A definition is a top-level block wherever the author wrote it, and the
  // idiom is to write them all together at the foot of the source — past every
  // exercise directive, and so past the point where the prose that cites them
  // was flushed into its own node. Each run is rendered on its own, so a
  // reference can only resolve against a definition in the same run: without
  // this, the ordinary way of writing footnotes would leave every marker
  // pointing at a note that was never emitted. Taking a definition out of the
  // map as it is used keeps a note referenced from two runs from being rendered
  // twice under the same id; the second marker stays literal text.
  const footnoteDefinitions = new Map<string, MarkdownNode>();
  // Shared by every block that renders markdown — the runs of prose below and
  // each exercise's prompt — so that the notes of a lesson read 1, 2, 3 down the
  // page instead of restarting at each exercise, and so that a `\newcommand` at
  // the top of a document is in scope for a formula inside an exercise further
  // down it. The math engine also collects the formulas that would not parse,
  // which become diagnostics once the whole document has been walked.
  const renderOptions = {
    footnoteNumbering: createFootnoteNumbering(),
    math: createMathCompiler(),
  };

  for (const child of tree.children as MarkdownNode[]) {
    if (child.type === "footnoteDefinition") {
      footnoteDefinitions.set(child.identifier, child);
    }
  }

  async function flushMarkdown(): Promise<void> {
    if (markdownChildren.length === 0) {
      return;
    }

    const cited: MarkdownNode[] = [];

    for (const identifier of footnoteReferencesIn(markdownChildren)) {
      const definition = footnoteDefinitions.get(identifier);

      if (definition !== undefined) {
        footnoteDefinitions.delete(identifier);
        cited.push(definition);
      }
    }

    const html = await renderMarkdownChildren(
      [...markdownChildren, ...cited],
      renderOptions,
    );

    if (html.length > 0) {
      nodes.push({ html, kind: "markdown" });
    }

    markdownChildren = [];
  }

  for (const child of tree.children as MarkdownNode[]) {
    // Style directives carry raw CSS, not content: extract the body verbatim
    // (the markdown-parsed children would mangle it) without flushing, so a
    // style block mid-prose leaves the surrounding markdown as one node.
    if (isStyleDirective(child)) {
      const block = directiveBlockFromNode(child, lines);

      for (const attribute of Object.keys(block.attrs)) {
        if (attribute !== "reset" && attribute !== "src") {
          diagnostics.push(
            diagnostic(
              block.line,
              "invalid_style_attributes",
              "The style directive does not support the {attribute} attribute.",
              { params: { attribute } },
            ),
          );
        }
      }

      cssReset = cssReset || "reset" in block.attrs;

      const src = block.attrs.src;

      if (src !== undefined) {
        if (isValidStylesheetHref(src)) {
          cssHrefs.push(src);
        } else {
          diagnostics.push(
            diagnostic(
              block.line,
              "invalid_style_src",
              "The style src must be an https URL or a site-relative path.",
            ),
          );
        }
      }

      const css = block.bodyLines.join("\n").trim();

      if (css.length > 0) {
        cssParts.push(css);
      }

      continue;
    }

    // `:::aufbau-mm0` declares a named theory (not an exercise). Collect it so
    // later proof blocks can reference it; it reaches the page only when the
    // author asked for the read-only panel with `show`.
    if (isAufbauMm0Directive(child)) {
      await flushMarkdown();

      const block = directiveBlockFromNode(child, lines);
      const theory = await compileAufbauMm0(
        block,
        diagnostics,
        resolveTheory,
      );

      if (theory !== null) {
        if (theories.has(theory.name)) {
          diagnostics.push(
            diagnostic(
              block.line,
              "duplicate_theory",
              "A theory named “{name}” is already declared.",
              { params: { name: theory.name } },
            ),
          );
        } else {
          theories.set(theory.name, theory);
        }

        if (theory.show) {
          nodes.push({
            kind: "theory",
            mm0: theory.source,
            name: theory.name,
          });
        }
      }

      continue;
    }

    collectInvalidItemLinkDiagnostics(child, diagnostics);

    if (!isContainerDirective(child)) {
      collectNestedDirectiveDiagnostics(child, diagnostics);

      // A footnote definition is not prose: it belongs wherever its marker is,
      // which `flushMarkdown` decides. Left in the run it was written in, it
      // would be rendered a second time under an id the page already has.
      if (child.type !== "footnoteDefinition") {
        markdownChildren.push(child);
      }

      continue;
    }

    await flushMarkdown();

    const block = directiveBlockFromNode(child, lines);

    const dataLines = dataBodyLines(block);

    for (const nested of block.children) {
      collectNestedDirectiveDiagnostics(nested, diagnostics, dataLines);
    }

    let exerciseKind: string;

    try {
      exerciseKind = authoringRegistry.typeForDirective(
        block.name,
      ).exerciseKind;
    } catch {
      diagnostics.push(
        diagnostic(
          block.line,
          "unsupported_directive",
          "Directive {name} is not supported.",
          { params: { name: block.name } },
        ),
      );
      continue;
    }

    const compiled =
      exerciseKind === MULTIPLE_CHOICE_KIND
        ? await compileMultipleChoice(block, diagnostics, renderOptions)
        : exerciseKind === FREE_RESPONSE_KIND
          ? await compileFreeResponse(block, diagnostics, renderOptions)
          : exerciseKind === SHORT_ANSWER_KIND
            ? await compileShortAnswer(block, diagnostics, renderOptions)
            : exerciseKind === TRUTH_TABLE_KIND
              ? await compileTruthTable(
                  block,
                  resolveSystem,
                  diagnostics,
                  renderOptions,
                )
              : exerciseKind === MODEL_KIND
                ? await compileModel(
                    block,
                    resolveSystem,
                    diagnostics,
                    renderOptions,
                  )
                : exerciseKind === AUFBAU_PROOF_KIND
                  ? await compileAufbauProof(
                      block,
                      resolveSystem,
                      diagnostics,
                      renderOptions,
                    )
                  : exerciseKind === AUFBAU_PROOF_TREE_KIND
                    ? await compileAufbauProofTree(
                        block,
                        resolveSystem,
                        diagnostics,
                        renderOptions,
                      )
                    : exerciseKind === AUFBAU_PROOF_FITCH_KIND
                      ? await compileAufbauProofFitch(
                          block,
                          resolveSystem,
                          diagnostics,
                          renderOptions,
                        )
                      : exerciseKind === AUFBAU_PROOF_PRAWITZ_KIND
                        ? await compileAufbauProofPrawitz(
                            block,
                            resolveSystem,
                            diagnostics,
                            renderOptions,
                          )
                        : exerciseKind === TRANSLATION_KIND
                          ? await compileTranslation(
                              block,
                              resolveSystem,
                              diagnostics,
                              renderOptions,
                            )
                          : null;

    if (compiled === null) {
      continue;
    }

    if (exerciseIds.has(compiled.manifestItem.id)) {
      diagnostics.push(
        diagnostic(
          block.line,
          "duplicate_exercise_id",
          "Exercise ID {id} is used more than once.",
          { params: { id: compiled.manifestItem.id } },
        ),
      );
      continue;
    }

    exerciseIds.add(compiled.manifestItem.id);
    nodes.push(compiled.node);
    manifest.push(compiled.manifestItem);
  }

  await flushMarkdown();

  // Drained once, at the end, rather than after each block: a formula reaches
  // the engine from a run of prose, an exercise prompt, a rubric and an option
  // label, and gathering them here means every one of those paths reports the
  // same way without having to remember to. Sorted, because the order they were
  // found in is the order the blocks rendered in rather than the order the
  // author reads — a multiple-choice directive renders its option labels before
  // its prompt, so a broken formula in each would be listed bottom-first.
  const mathFailures = [...renderOptions.math.failures].sort(
    (left, right) => left.line - right.line || left.column - right.column,
  );

  for (const failure of mathFailures) {
    diagnostics.push(mathDiagnostic(failure));
  }

  // Errors alone decide. Warnings ride along on a *successful* compile — that
  // is the whole point of them — so the editor can list what the author may
  // want to know without the save refusing on their behalf.
  if (diagnostics.some((entry) => entry.severity === "error")) {
    return { diagnostics, ok: false };
  }

  const css = cssParts.join("\n\n");
  const systems = referencedSystems(theories, manifest);

  return {
    // Joined, not keyed. A compiled artifact is nearly always about to be
    // rendered or inspected, and every one of those callers wants each
    // exercise's theory text in hand; the one caller that does not — the save,
    // on its way into the `compiled` column — calls `keyedArtifact`. Storage
    // and the wire carry the key; memory carries the text.
    artifact: withSystemSources({
      componentRegistryVersion: COMPONENT_REGISTRY_VERSION,
      ...(css.length === 0 ? {} : { css }),
      ...(cssHrefs.length === 0 ? {} : { cssHrefs }),
      ...(cssReset ? { cssReset: true } : {}),
      document: { nodes, profile: PROFILE },
      manifest,
      manifestVersion: MANIFEST_VERSION,
      sourceProfile: PROFILE,
      ...(Object.keys(systems).length === 0 ? {} : { systems }),
    }),
    diagnostics,
    ok: true,
  };
}
