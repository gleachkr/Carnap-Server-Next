/**
 * Live preview for the revision editor. This bundle runs the *same* compiler,
 * exercise renderer, and content-document builder the server uses, so what
 * the author sees while typing is byte-for-byte what a saved revision's
 * document route will serve. Edits recompile after a short pause and replace
 * the preview iframe's srcdoc; diagnostics render under the textarea.
 *
 * On narrow viewports the two split columns stack, so a Write/Preview switch
 * (revealed here — it is inert without JS) shows one at a time instead.
 */
import type { EditorView } from "@codemirror/view";
import { raw } from "hono/html";
import type { CompilerDiagnostic } from "../worker/application/content/authoring-toolkit";
import { compileCarnapMarkdown } from "../worker/application/content/compiler";
import {
  componentAssetsForArtifact,
  exerciseHydrationForArtifact,
  renderCompiledContent,
} from "../worker/application/content/renderer";
import type { CompiledContentArtifact } from "../worker/domain/content";
import {
  AUFBAU_PROOF_KIND,
  type AufbauProofPublicData,
  isAufbauProofPublicData,
} from "../worker/exercises/aufbau-proof/types";
import {
  AUFBAU_PROOF_TREE_KIND,
  type AufbauProofTreePublicData,
  isAufbauProofTreePublicData,
} from "../worker/exercises/aufbau-proof-tree/types";
import {
  formatMessage,
  resolveMessage,
  splitAtValue,
  stringsResolver,
  type Translator,
  VALUE,
} from "../worker/i18n/translator";
import {
  artifactStyleProps,
  contentDocumentHtml,
} from "../worker/web/content-document";
import {
  EDITOR_UI_STRINGS_ATTRIBUTE,
  type EditorUiStrings,
  payloadTranslator,
} from "../worker/web/ui-strings";
import { createMarkdownEditor, showDiagnostics } from "./markdown-editor";
import { warnBeforeDiscarding } from "./unsaved-changes";

const DEBOUNCE_MS = 250;
const COMPILER_WASM_URL = "/assets/aufbau-compiler.wasm";

// The engine's diagnostic for a well-formed theory + goal with no proof body —
// benign at authoring time (the student supplies the proof), so a tree exercise
// whose only complaint is this counts as "declares cleanly".
const EMPTY_PROOF_MESSAGE = "proof block is empty";

// The Aufbau compiler is loaded lazily (its ~4.5 MB wasm) and only when the
// document actually contains a proof exercise, then reused across recompiles.
let proofCompilerPromise: Promise<{
  compile(
    mm0: string,
    proof: string,
  ): { ok?: boolean; diagnostics?: unknown };
}> | null = null;

function loadProofCompiler() {
  if (proofCompilerPromise === null) {
    proofCompilerPromise = import("@aufbau/compiler").then((module) =>
      module.loadCompiler({ wasmUrl: COMPILER_WASM_URL }),
    );
  }
  return proofCompilerPromise;
}

function firstDiagnostic(result: { diagnostics?: unknown }): string | null {
  const diagnostics = result.diagnostics;
  if (!Array.isArray(diagnostics) || diagnostics.length === 0) {
    return null;
  }
  const first = diagnostics[0];
  if (typeof first === "string") {
    return first;
  }
  const message = (first as { message?: unknown })?.message;
  return typeof message === "string" ? message : null;
}

/**
 * Wording for the author-only engine checks, from this page's strings payload
 * with English fallbacks — the same `?? "English"` discipline the inline
 * enhancement scripts use, so a page cached from before the payload existed
 * still reads sensibly.
 */
type ProofCheckStrings = EditorUiStrings["proofChecks"];

function proofCheckStrings(): ProofCheckStrings {
  const fromPage = editorStrings().proofChecks;

  return {
    declaresCleanly: fromPage?.declaresCleanly || "goal declares cleanly ✓",
    notVerified: fromPage?.notVerified || "not verified",
    result: fromPage?.result || "{id} — {status}",
    starterVerifies: fromPage?.starterVerifies || "starter verifies ✓",
    unreadableStarter:
      fromPage?.unreadableStarter ||
      "the proof engine could not read this starter",
    unreadableTheory:
      fromPage?.unreadableTheory ||
      "the proof engine could not read this theory or goal",
  };
}

interface ProofCheck {
  readonly id: string;
  readonly ok: boolean;
  /** What to show on success (types differ: "verifies" vs "declares cleanly"). */
  readonly okLabel: string;
  readonly message: string | null;
}

/**
 * Run the Aufbau engine over each proof exercise's frozen theory + starter,
 * exactly as a student's browser would — so an author sees a malformed theory or
 * a starter that does not yet verify while writing. A stub starter legitimately
 * fails to verify; the note is informational, not a content error.
 */
async function proofChecksFor(
  artifact: CompiledContentArtifact,
  strings: ProofCheckStrings,
): Promise<ProofCheck[]> {
  const proofs = artifact.manifest.filter(
    (item): item is typeof item & { publicData: AufbauProofPublicData } =>
      item.kind === AUFBAU_PROOF_KIND &&
      isAufbauProofPublicData(item.publicData),
  );

  if (proofs.length === 0) {
    return [];
  }

  const compiler = await loadProofCompiler();

  return proofs.map((proof) => {
    const { goalName, mm0, starterBody } = proof.publicData;
    try {
      const result = compiler.compile(
        mm0,
        `${goalName}\n----\n${starterBody}`,
      );
      return {
        id: proof.id,
        message: result.ok === true ? null : firstDiagnostic(result),
        ok: result.ok === true,
        okLabel: strings.starterVerifies,
      };
    } catch {
      // Malformed source can make the compiler throw instead of reporting a
      // diagnostic; keep the preview alive with a generic note.
      return {
        id: proof.id,
        message: strings.unreadableStarter,
        ok: false,
        okLabel: strings.starterVerifies,
      };
    }
  });
}

/**
 * Author-check each tree proof exercise. A tree has no starter proof to verify,
 * so we confirm the frozen theory + goal *declare cleanly*: compile an empty
 * body and treat the benign "proof block is empty" as success (the theory and
 * goal parsed; the student supplies the proof). Any other diagnostic is a real
 * theory or goal problem the author should see.
 */
async function treeChecksFor(
  artifact: CompiledContentArtifact,
  strings: ProofCheckStrings,
): Promise<ProofCheck[]> {
  const trees = artifact.manifest.filter(
    (item): item is typeof item & { publicData: AufbauProofTreePublicData } =>
      item.kind === AUFBAU_PROOF_TREE_KIND &&
      isAufbauProofTreePublicData(item.publicData),
  );

  if (trees.length === 0) {
    return [];
  }

  const compiler = await loadProofCompiler();

  return trees.map((tree) => {
    const { goalName, mm0 } = tree.publicData;
    try {
      const result = compiler.compile(mm0, `${goalName}\n----\n`);
      const message = firstDiagnostic(result);
      const declaresCleanly =
        result.ok === true ||
        message === null ||
        message === EMPTY_PROOF_MESSAGE;
      return {
        id: tree.id,
        message: declaresCleanly ? null : message,
        ok: declaresCleanly,
        okLabel: strings.declaresCleanly,
      };
    } catch {
      return {
        id: tree.id,
        message: strings.unreadableTheory,
        ok: false,
        okLabel: strings.declaresCleanly,
      };
    }
  });
}

function renderProofChecks(
  host: HTMLElement,
  checks: readonly ProofCheck[],
  strings: ProofCheckStrings,
): void {
  host.querySelector(".proof-checks")?.remove();

  if (checks.length === 0) {
    return;
  }

  const list = document.createElement("ul");
  list.className = "proof-checks";

  for (const check of checks) {
    const entry = document.createElement("li");
    const code = document.createElement("code");
    code.textContent = check.id;
    // Whole sentence, split around the id, so the dash and the word order are
    // the translator's to place — see the diagnostics list below.
    const [before, after] = splitAtValue(
      formatMessage(strings.result, {
        id: VALUE,
        status: check.ok
          ? check.okLabel
          : (check.message ?? strings.notVerified),
      }),
    );
    entry.append(before, code, after);
    entry.dataset.state = check.ok ? "ok" : "error";
    list.append(entry);
  }

  host.append(list);
}

function renderDiagnostics(
  host: HTMLElement,
  diagnostics: readonly CompilerDiagnostic[],
): void {
  host.replaceChildren();

  if (diagnostics.length === 0) {
    return;
  }

  const list = document.createElement("ul");
  list.className = "diagnostics";
  const strings = editorStrings();
  const template = strings.diagnostic ?? "{code} line {line}: {message}";
  // Each diagnostic's own sentence is looked up in the payload the server
  // resolved for this page; a miss leaves the English the compiler emitted.
  const resolve = stringsResolver(strings.diagnostics ?? {});

  for (const item of diagnostics) {
    const entry = document.createElement("li");
    const code = document.createElement("code");
    code.textContent = item.code;
    // The same whole sentence the server-rendered list uses, split around the
    // element that shows the code — so both halves of the editor agree and a
    // translator can put the code wherever the sentence needs it.
    const [before, after] = splitAtValue(
      formatMessage(template, {
        code: VALUE,
        line: item.line,
        message: resolveMessage(item, resolve),
      }),
    );
    entry.append(before, code, after);
    list.append(entry);
  }

  host.append(list);
}

/**
 * The editor's server-resolved strings, from the payload the revision-editor page
 * emits next to this bundle's `<script>`. Missing or unparsable means English
 * fallbacks, never a broken list.
 */
function editorStrings(): Partial<EditorUiStrings> {
  const element = document.querySelector(`[${EDITOR_UI_STRINGS_ATTRIBUTE}]`);

  if (element === null) {
    return {};
  }

  try {
    return JSON.parse(
      element.textContent || "{}",
    ) as Partial<EditorUiStrings>;
  } catch (_error) {
    return {};
  }
}

/**
 * The translator this bundle renders the preview document with — the words and
 * the language, both out of the one payload the server sent.
 *
 * This is the whole reason the payload carries a locale. The rebuild used to
 * word itself with `passthroughTranslator` (source English) while taking its
 * `lang` from `document.documentElement`, so a German author's first keystroke
 * turned the preview English underneath an unchanged `lang="de"`. Carrying both
 * on one object makes that state unrepresentable: no strings means no locale
 * either, and English prose correctly declares itself English.
 *
 * Resolved once — the payload is inert, and the rebuild runs on every edit.
 */
let preview: Translator | null = null;

function previewTranslator(): Translator {
  if (preview === null) {
    const strings = editorStrings().preview;

    preview = payloadTranslator(
      strings?.strings ?? {},
      // No payload at all (a page cached from before one existed) means no
      // translations, and what the widgets and the document fall back to is
      // their English source text.
      strings?.locale ?? "en",
    );
  }

  return preview;
}

/**
 * Swap the form's textarea for a CodeMirror view. The textarea stays — hidden,
 * still named `sourceText`, still what the form submits — and this writes the
 * document through to it on every edit, so the save path is untouched and the
 * page without JS is the page it always was.
 */
function mountEditor(
  source: HTMLTextAreaElement,
  onChange: () => void,
): EditorView | null {
  const label = source.labels?.[0] ?? null;

  if (label === null || label.id.length === 0) {
    // No label to point CodeMirror's content at means no accessible name for
    // it; the textarea, which has one, is the better editor of the two.
    return null;
  }

  const host = document.createElement("div");
  host.className = "markdown-source editor-source";
  source.after(host);
  source.hidden = true;

  const view = createMarkdownEditor({
    // A page cached from before this payload carried them falls back to the
    // English the strings were written in, as every other lookup here does.
    foldLabels: editorStrings().fold ?? {
      fold: "Fold this block",
      unfold: "Unfold this block",
    },
    labelledBy: label.id,
    onChange: (value) => {
      source.value = value;
      onChange();
    },
    parent: host,
    value: source.value,
  });

  return view;
}

function setUpPreview(
  split: HTMLElement,
  source: HTMLTextAreaElement,
  frame: HTMLIFrameElement,
  diagnosticsHost: HTMLElement,
): void {
  let latest = 0;
  // Assigned below, once the debounce is in place for it to drive. Read only
  // from `render`, which nothing calls before then.
  let editor: EditorView | null = null;

  const render = async (): Promise<void> => {
    const sequence = ++latest;
    const compiled = await compileCarnapMarkdown(source.value);

    // A newer edit finished compiling first; drop this stale result.
    if (sequence !== latest) {
      return;
    }

    renderDiagnostics(diagnosticsHost, compiled.diagnostics);

    if (editor !== null) {
      // The same sentences the list under the editor shows, on the lines they
      // are about. Resolved here rather than in the editor module so both
      // renderings of a diagnostic go through one translation path.
      const resolve = stringsResolver(editorStrings().diagnostics ?? {});

      showDiagnostics(
        editor,
        compiled.diagnostics.map((item) => ({
          line: item.line,
          message: resolveMessage(item, resolve),
        })),
      );
    }
    // On failure the last good preview stays up, dimmed as stale.
    split.classList.toggle("preview-stale", !compiled.ok);

    if (compiled.ok) {
      // The rebuild has no request and no catalog — an i18n module import here
      // would ship `@lingui/core` and every locale in this bundle. It words
      // itself from the strings the server resolved for this page instead, so
      // the preview stays in the author's language across edits.
      const i18n = previewTranslator();

      // Before the srcdoc, not after: the class is what un-hides the frame,
      // and a document that loads into a `display: none` iframe measures
      // itself against no layout, so the height it reports back is useless.
      // Once a preview exists it is never empty again — a later failure keeps
      // it and dims it.
      split.classList.remove("preview-empty");

      // No `escapeFrame` here, unlike the frames that hold a saved document: a
      // link followed out of the preview would replace this editor, and the
      // source in it is unsaved by definition.
      frame.srcdoc = contentDocumentHtml({
        body: raw(renderCompiledContent(compiled.artifact, i18n)),
        componentAssets: componentAssetsForArtifact(compiled.artifact),
        exerciseHydration: exerciseHydrationForArtifact(
          compiled.artifact,
          i18n,
        ),
        i18n,
        locale: i18n.locale,
        ...artifactStyleProps(compiled.artifact),
        // The frame's own title, which the server already resolved for this
        // page's language.
        title: frame.title || "Preview",
      });

      // Engine-check any proof exercises (async: loads the compiler wasm) —
      // linear starters verify, tree goals declare cleanly.
      const checkStrings = proofCheckStrings();
      const checks = [
        ...(await proofChecksFor(compiled.artifact, checkStrings)),
        ...(await treeChecksFor(compiled.artifact, checkStrings)),
      ];
      if (sequence === latest) {
        renderProofChecks(diagnosticsHost, checks, checkStrings);
      }
    } else {
      renderProofChecks(diagnosticsHost, [], proofCheckStrings());
    }
  };

  let pending: number | undefined;

  const scheduleRender = (): void => {
    clearTimeout(pending);
    pending = setTimeout(() => void render(), DEBOUNCE_MS);
  };

  editor = mountEditor(source, scheduleRender);

  if (editor === null) {
    // The field tracks its content's height (CSS suppresses the drag handle
    // and scrollbar): collapse it, then take the scroll height it reports.
    const autosize = (): void => {
      source.style.height = "auto";
      source.style.height = `${String(source.scrollHeight + 2)}px`;
    };

    source.addEventListener("input", () => {
      autosize();
      scheduleRender();
    });

    autosize();
  } else {
    // The server already listed the diagnostics for the initial source; mirror
    // them onto the lines so a revision that arrives broken says so in place,
    // without waiting for the first keystroke.
    void render();
  }
}

function setUpModeSwitch(split: HTMLElement, control: HTMLElement): void {
  // The switch only matters when the columns stack; CSS keeps it hidden on
  // wide viewports, and this reveal keeps it hidden without JS.
  control.dataset.enhanced = "true";

  control.addEventListener("click", (event) => {
    const target = event.target;

    if (!(target instanceof Element)) {
      return;
    }

    const button = target.closest("[data-mode-target]");

    if (!(button instanceof HTMLElement)) {
      return;
    }

    split.dataset.mode = button.dataset.modeTarget;

    for (const other of control.querySelectorAll("[data-mode-target]")) {
      other.setAttribute("aria-pressed", String(other === button));
    }
  });
}

const split = document.querySelector<HTMLElement>("[data-editor-split]");
const source = document.querySelector<HTMLTextAreaElement>(
  "[data-editor-source]",
);
const frame = split?.querySelector<HTMLIFrameElement>("iframe.content-frame");
const diagnosticsHost = document.querySelector<HTMLElement>(
  "[data-editor-diagnostics]",
);
const modeSwitch = document.querySelector<HTMLElement>(
  "[data-editor-mode-switch]",
);

// Guarded on its own, ahead of the preview: a revision that is only ever saved
// once is exactly the thing worth not losing, and it is still worth not losing
// on a page where the preview could not be set up.
if (source?.form != null) {
  warnBeforeDiscarding(source.form);
}

if (
  split !== null &&
  source !== null &&
  frame !== null &&
  frame !== undefined &&
  diagnosticsHost !== null
) {
  setUpPreview(split, source, frame, diagnosticsHost);

  if (modeSwitch !== null) {
    setUpModeSwitch(split, modeSwitch);
  }
}
