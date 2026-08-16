/** @jsxImportSource preact */
/**
 * `<carnap-aufbau-proof-tree>` — the interactive *tree* proof editor.
 *
 * The student builds a proof tree instead of typing linear proof lines. The
 * server renders an inert goal seed into a Declarative Shadow Root (see
 * `renderAufbauProofTreeElement`); on connect this element adopts that shadow
 * root and mounts a small Preact island that renders the tree with editing
 * affordances: each node's conclusion and inference rule are editable, a node
 * can be selected, and a toolbar adds a premise, adds a hypothesis reference, or
 * deletes the selected subtree. The tree is drawn by the vendored ProofML custom
 * elements (imported here for their side effect of registering `<proof-tree>`
 * etc.); Preact renders those custom-element tags declaratively.
 *
 * The editable document (`{ model, selectedId }`) is an *immutable* value driven
 * by a pure reducer, so a re-render is `render(view(doc), mount)` and structural
 * edits (add/delete, undo/redo) never poke the DOM by hand. Only the
 * contenteditable text fields are *uncontrolled* — Preact renders each once
 * (keyed by node id) and never rewrites its text while it is focused, so the
 * caret survives typing (the same reason the linear editor leans on CodeMirror).
 * Preact is used only on the interactive path; on review pages the module still
 * just registers the ProofML elements and no island mounts.
 *
 * On every model edit the tree is flattened (postorder) to the same `.auf` the
 * linear editor produces and compiled against the frozen theory with the
 * lazily-loaded `@aufbau/compiler`; the answer mirrored into the form is
 * `{ mmb, proofText, tree }`. As with the linear type the MMB is the certificate
 * and the worker is the arbiter — the compiler here is an untrusted convenience.
 * A compiler diagnostic (a UTF-8 byte span into the flattened text) is mapped
 * back through the flattener's line map onto the tree node that produced the
 * offending line.
 */
import type { CompileResult, LoadedCompiler } from "@aufbau/compiler";
import { render } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { flattenProofTree } from "../../worker/exercises/aufbau-proof-tree/flatten";
import type { AufbauProofTreeStringId } from "../../worker/exercises/aufbau-proof-tree/strings";
import type {
  AufbauProofTreePublicData,
  ProofTreeNode,
} from "../../worker/exercises/aufbau-proof-tree/types";
import type { CorrectnessMarkState } from "../../worker/exercises/correctness-mark";
import { loadProofCompiler } from "../proof-compiler";
import { CarnapExerciseElement, register, withoutCertificate } from "./base";
import {
  createHelpDialog,
  HELP_DIALOG_STYLES,
  mountHelpTrigger,
  openHelpDialog,
} from "./help-dialog";
import "../vendor/proofml.mjs";

// The ProofML display elements are custom tags, not standard HTML; declare them
// so JSX type-checks. They carry no attributes we set beyond the base HTML set.
declare module "preact" {
  // A `namespace`, because that is the shape Preact declares JSX as and
  // module augmentation has to match it.
  namespace JSX {
    interface IntrinsicElements {
      "proof-forest": JSX.HTMLAttributes<HTMLElement>;
      "proof-inference": JSX.HTMLAttributes<HTMLElement>;
      "proof-proposition": JSX.HTMLAttributes<HTMLElement>;
      "proof-tree": JSX.HTMLAttributes<HTMLElement>;
    }
  }
}

const DEBOUNCE_MS = 400;
const HISTORY_LIMIT = 100;

/**
 * Interface text for the island's components. The toolbar and mark are plain
 * functions outside the element, so they receive the lookup as a prop instead of
 * reaching into the hydration payload themselves.
 */
type Translate = (id: AufbauProofTreeStringId) => string;

// ---------------------------------------------------------------------------
// Byte/base64 helpers (unchanged from the imperative version).
// ---------------------------------------------------------------------------

function utf8Length(codePoint: number): number {
  if (codePoint < 0x80) {
    return 1;
  }
  if (codePoint < 0x800) {
    return 2;
  }
  if (codePoint < 0x10000) {
    return 3;
  }
  return 4;
}

/** Map a UTF-8 byte offset (as the compiler reports spans) to a JS string index. */
function byteToCharIndex(text: string, byteOffset: number): number {
  let bytes = 0;
  let index = 0;
  for (const char of text) {
    if (bytes >= byteOffset) {
      break;
    }
    bytes += utf8Length(char.codePointAt(0) ?? 0);
    index += char.length;
  }
  return index;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function isTreePublicData(
  value: unknown,
): value is AufbauProofTreePublicData {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { mm0?: unknown }).mm0 === "string" &&
    typeof (value as { goalName?: unknown }).goalName === "string" &&
    typeof (value as { goalFormula?: unknown }).goalFormula === "string"
  );
}

function isProofTreeNode(value: unknown): value is ProofTreeNode {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { formula?: unknown }).formula === "string" &&
    typeof (value as { rule?: unknown }).rule === "string" &&
    Array.isArray((value as { premises?: unknown }).premises)
  );
}

// ---------------------------------------------------------------------------
// The editable document: an immutable tree plus the selected node id.
// ---------------------------------------------------------------------------

/** Immutable editing node; serialized to a {@link ProofTreeNode} to grade. */
interface TreeNode {
  readonly formula: string;
  readonly hyp: number | null;
  readonly id: string;
  readonly premises: readonly TreeNode[];
  readonly rule: string;
}

interface Doc {
  readonly model: TreeNode;
  readonly selectedId: string;
}

/** Transient compile feedback — derived, never part of the undoable document. */
interface Status {
  readonly mark: CorrectnessMarkState;
  readonly markTitle: string;
  readonly nodeErrors: Readonly<Record<string, string>>;
}

type Action =
  | { readonly type: "select"; readonly id: string }
  | {
      readonly type: "setFormula";
      readonly id: string;
      readonly text: string;
    }
  | { readonly type: "setRule"; readonly id: string; readonly text: string }
  | { readonly type: "setHyp"; readonly id: string; readonly hyp: number }
  | { readonly type: "addPremise"; readonly hyp: number | null }
  | { readonly type: "delete" };

let idCounter = 0;
function uid(): string {
  idCounter += 1;
  return `n${idCounter}`;
}

/**
 * Rebuild the editing tree from a serialized (prior-answer) tree, minting a
 * *fresh* id for every node rather than trusting the stored ones. Ids are only
 * ephemeral editing handles (the reducer's `locate`/`replaceNode` key, and the
 * flattener's diagnostic line map) with no cross-session meaning, so re-minting
 * keeps the whole-document invariant that every id is unique and drawn from the
 * monotonic counter. If we kept the stored ids the counter would still sit at 0,
 * and the first `Add premise` would mint an id that collides with a restored one
 * — `locate` then resolves to the first (shallowest) match, so selection, the
 * highlight, and delete would silently target an ancestor instead of the new node.
 */
function deserialize(node: ProofTreeNode): TreeNode {
  return {
    formula: node.formula,
    hyp: node.hyp ?? null,
    id: uid(),
    premises: node.premises.map(deserialize),
    rule: node.rule,
  };
}

function serialize(node: TreeNode): ProofTreeNode {
  if (node.hyp !== null) {
    return {
      formula: node.formula,
      hyp: node.hyp,
      id: node.id,
      premises: [],
      rule: node.rule,
    };
  }
  return {
    formula: node.formula,
    id: node.id,
    premises: node.premises.map(serialize),
    rule: node.rule,
  };
}

/** Find a node and its parent id (parent is null for the root). */
function locate(
  root: TreeNode,
  id: string,
  parentId: string | null = null,
): { node: TreeNode; parentId: string | null } | null {
  if (root.id === id) {
    return { node: root, parentId };
  }
  for (const child of root.premises) {
    const found = locate(child, id, root.id);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

/**
 * Return a copy of the tree with node `id` replaced by `fn(node)`. Structural
 * sharing: any subtree without the target is returned by reference, and if `fn`
 * makes no change the whole tree comes back unchanged — so a reducer can detect
 * a no-op by identity (`next === prev`).
 */
function replaceNode(
  root: TreeNode,
  id: string,
  fn: (node: TreeNode) => TreeNode,
): TreeNode {
  if (root.id === id) {
    return fn(root);
  }
  let changed = false;
  const premises = root.premises.map((child) => {
    const next = replaceNode(child, id, fn);
    if (next !== child) {
      changed = true;
    }
    return next;
  });
  return changed ? { ...root, premises } : root;
}

function seedChild(hyp: number | null, parentFormula: string): TreeNode {
  return {
    formula: hyp === null ? "" : parentFormula,
    hyp,
    id: uid(),
    premises: [],
    rule: "",
  };
}

/**
 * The undo key for an action, or null if the edit must stand alone in history.
 * Consecutive text edits to the *same* field share a key so a run of keystrokes
 * collapses into one undo step; structural edits (add/delete) never coalesce.
 */
function coalesceKeyFor(action: Action): string | null {
  switch (action.type) {
    case "setFormula":
    case "setRule":
    case "setHyp":
      return `${action.type}:${action.id}`;
    default:
      return null;
  }
}

function docReducer(doc: Doc, action: Action): Doc {
  switch (action.type) {
    case "select":
      return action.id === doc.selectedId
        ? doc
        : { ...doc, selectedId: action.id };

    case "setFormula": {
      const model = replaceNode(doc.model, action.id, (node) =>
        node.formula === action.text
          ? node
          : { ...node, formula: action.text },
      );
      return model === doc.model ? doc : { ...doc, model };
    }

    case "setRule": {
      const model = replaceNode(doc.model, action.id, (node) =>
        node.rule === action.text ? node : { ...node, rule: action.text },
      );
      return model === doc.model ? doc : { ...doc, model };
    }

    case "setHyp": {
      const model = replaceNode(doc.model, action.id, (node) =>
        node.hyp === action.hyp ? node : { ...node, hyp: action.hyp },
      );
      return model === doc.model ? doc : { ...doc, model };
    }

    case "addPremise": {
      const selected = locate(doc.model, doc.selectedId);
      if (selected === null || selected.node.hyp !== null) {
        return doc;
      }
      const child = seedChild(action.hyp, selected.node.formula);
      const model = replaceNode(doc.model, doc.selectedId, (node) => ({
        ...node,
        premises: [...node.premises, child],
      }));
      // Selection stays on the parent, not the new child: authors commonly add
      // several premises above one node before working on any of them, so
      // keeping focus put lets repeated Add/`p`/`h` stack siblings in place.
      return { model, selectedId: doc.selectedId };
    }

    case "delete": {
      const selected = locate(doc.model, doc.selectedId);
      if (selected === null || selected.parentId === null) {
        return doc;
      }
      const model = replaceNode(doc.model, selected.parentId, (node) => ({
        ...node,
        premises: node.premises.filter(
          (child) => child.id !== selected.node.id,
        ),
      }));
      return { model, selectedId: selected.parentId };
    }
  }
}

// ---------------------------------------------------------------------------
// Presentation (Preact).
// ---------------------------------------------------------------------------

const SHADOW_STYLES = `
  ${HELP_DIALOG_STYLES}

  .tree-toolbar {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin: 0.6rem 0 0.2rem;
  }
  .tree-toolbar button {
    background: var(--control-surface, #fbf7ef);
    border: 1px solid var(--rule, #d8d0c3);
    border-radius: 0.3rem;
    color: var(--blue-strong, #074f9f);
    cursor: pointer;
    font: inherit;
    font-size: 0.78rem;
    padding: 0.2rem 0.55rem;
  }
  .tree-toolbar button:disabled {
    color: var(--ink-muted, #5f7388);
    cursor: default;
    opacity: 0.55;
  }
  .tree-edit {
    border-bottom: 1px dashed transparent;
    /* Fira Code first (loaded as a web font) so its contextual ligatures turn
       typed connectives like -> and <-> into → and ↔ in the rendered proof. */
    font-family: "Fira Code", ui-monospace, monospace;
    min-width: 1ch;
    outline: none;
    padding: 0 0.1rem;
    white-space: pre;
  }
  .tree-edit:focus { border-bottom-color: var(--blue, #0b66d8); }
  .tree-edit.is-selected { background: var(--blue-soft, #eaf3ff); }
  .tree-edit.is-error {
    border-bottom: 1px wavy var(--red, #b42318);
    text-decoration: underline wavy var(--red, #b42318);
  }
  .tree-edit:not(.is-selected):not(.is-empty):hover {
    background: var(--surface-soft, #f8f2e8);
  }
  /* An unfilled conclusion/rule: a tinted, comfortably-clickable box. */
  .tree-edit.is-empty {
    background: var(--blue-soft, #eaf3ff);
    border-bottom-color: transparent;
    border-radius: 0.2rem;
    display: inline-block;
    min-height: 1.15em;
    min-width: 2.6ch;
    outline: 1px dashed var(--blue, #0b66d8);
    outline-offset: 1px;
  }
  .tree-rule.is-empty { min-width: 3.4ch; }
  /* The read-only goal is still a selection target (add premises to it). */
  .tree-fixed { cursor: pointer; }
  /* Roving-focus wrapper: carries keyboard focus for tree navigation. */
  .tree-node { border-radius: 0.25rem; outline: none; }
  .tree-node:focus-visible {
    outline: 2px solid var(--blue, #0b66d8);
    outline-offset: 2px;
  }
`;

/**
 * What the `(?)` in the toolbar opens: how the editor works, and every key it
 * binds. Nothing of this is on the page — the button is the whole affordance —
 * so the table has to be complete, and it is the only place a reader learns that
 * `p`, `h`, and the arrows do anything at all.
 *
 * The key glyphs are literals — `Enter` is what is printed on the key — while
 * the actions are string ids, so `tsc` rejects a row the server never sent text
 * for.
 */
const SHORTCUTS: readonly {
  readonly action: AufbauProofTreeStringId;
  readonly keys: readonly string[];
}[] = [
  { action: "Move between lines", keys: ["↑", "↓", "←", "→"] },
  { action: "Edit the line's formula", keys: ["Enter"] },
  { action: "Edit the line's rule", keys: ["r"] },
  { action: "Leave the field and go back to the line", keys: ["Esc"] },
  { action: "Add a premise above the line", keys: ["p"] },
  { action: "Add a hypothesis above the line", keys: ["h"] },
  { action: "Delete the line and everything above it", keys: ["Del"] },
  { action: "Undo", keys: ["Ctrl-Z"] },
  { action: "Redo", keys: ["Ctrl-Y"] },
  { action: "Open this help", keys: ["?"] },
];

const INTRO_IDS: readonly AufbauProofTreeStringId[] = [
  "The goal sits at the bottom. Click any line to select it, then Add premise to grow the proof upward.",
  "Type the rule that justifies each inference in the field beneath its line. Add hypothesis makes a leaf that discharges against a rule below it.",
  "The mark beside the Submit button shows whether the proof checks; hover it to read the problem.",
];

/**
 * An *uncontrolled* contenteditable field. Preact renders the bare span (no
 * children) and never touches its text; we set the text imperatively only when
 * the model value changes *and* the field is not focused, so typing never resets
 * the caret. Attribute changes (selection, error, empty state) re-render freely.
 */
function EditableField(props: {
  readonly className: string;
  readonly editable: boolean;
  readonly error: string | undefined;
  readonly onInput?: (text: string) => void;
  readonly onSelect: () => void;
  readonly selected: boolean;
  readonly value: string;
}): preact.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (
      el !== null &&
      el.textContent !== props.value &&
      document.activeElement !== el
    ) {
      el.textContent = props.value;
    }
  }, [props.value]);

  const classes = [
    props.className,
    props.selected ? "is-selected" : "",
    props.value.trim().length === 0 ? "is-empty" : "",
    props.error !== undefined ? "is-error" : "",
  ]
    .filter((cls) => cls.length > 0)
    .join(" ");

  const onInput = props.onInput;
  return (
    // `contentEditable` makes an editable field of this span, which the rule
    // cannot see. When it is *not* editable the handlers only mirror, for the
    // mouse, what the enclosing treeitem already does from the keyboard.
    // biome-ignore lint/a11y/noStaticElementInteractions: see above.
    <span
      ref={ref}
      class={classes}
      contentEditable={props.editable ? true : undefined}
      onFocus={props.onSelect}
      onInput={
        onInput === undefined
          ? undefined
          : (event) => onInput(event.currentTarget.textContent ?? "")
      }
      onPointerDown={props.onSelect}
      spellcheck={props.editable ? false : undefined}
      // Kept out of the tab order: the enclosing treeitem carries the roving
      // focus; a field is entered by click or by pressing Enter on its node.
      tabIndex={-1}
      title={props.error}
    />
  );
}

function NodeView(props: {
  readonly dispatch: (action: Action) => void;
  readonly isRoot: boolean;
  readonly node: TreeNode;
  readonly nodeErrors: Readonly<Record<string, string>>;
  readonly onNodeKeyDown: (event: KeyboardEvent, id: string) => void;
  readonly onSelect: (id: string) => void;
  readonly registerNode: (id: string, el: HTMLElement | null) => void;
  readonly selectedId: string;
}): preact.JSX.Element {
  const { dispatch, isRoot, node, nodeErrors } = props;
  const { onNodeKeyDown, onSelect, registerNode, selectedId } = props;
  const isHyp = node.hyp !== null;
  // Every non-hypothesis proposition is justified by an inference, so it always
  // gets a proof-forest above it — empty when there are no premises yet. This
  // keeps a fitch bar (and the rule slot beneath it) present for zero-premise
  // rules like `ax`, and it's what draws the line at all: ProofML puts the bar
  // on the proposition only while the forest is *uninhabited* (proofml.mjs:205),
  // and it recomputes that style on the forest's own child-change event. If we
  // dropped the whole forest element when the last premise was deleted, no
  // slotchange would fire on the parent's forest slot, so the bar would stay
  // stale and vanish. A hypothesis leaf is an assumption — no forest, no line.
  const showForest = !isHyp;
  const select = (): void => onSelect(node.id);

  return (
    <proof-tree>
      {showForest ? (
        <proof-forest>
          {node.premises.map((child) => (
            <NodeView
              key={child.id}
              dispatch={dispatch}
              isRoot={false}
              node={child}
              nodeErrors={nodeErrors}
              onNodeKeyDown={onNodeKeyDown}
              onSelect={onSelect}
              registerNode={registerNode}
              selectedId={selectedId}
            />
          ))}
        </proof-forest>
      ) : null}
      <proof-proposition>
        <span
          aria-selected={node.id === selectedId}
          class="tree-node"
          onFocus={select}
          onKeyDown={(event) => {
            // Only navigate when the treeitem itself has focus; a key inside the
            // editable field (event.target !== the span) must type, not move.
            if (event.target === event.currentTarget) {
              onNodeKeyDown(event, node.id);
            }
          }}
          ref={(el) => registerNode(node.id, el)}
          role="treeitem"
          tabIndex={node.id === selectedId ? 0 : -1}
        >
          <EditableField
            className={["tree-edit", isRoot ? "tree-fixed" : ""]
              .filter((cls) => cls.length > 0)
              .join(" ")}
            editable={!isRoot}
            error={nodeErrors[node.id]}
            onInput={(text) =>
              dispatch({ id: node.id, text, type: "setFormula" })
            }
            onSelect={select}
            selected={node.id === selectedId}
            value={node.formula}
          />
        </span>
      </proof-proposition>
      <proof-inference>
        {isHyp ? (
          <EditableField
            className="tree-edit tree-rule"
            editable={true}
            error={undefined}
            onInput={(text) => {
              const match = /(\d+)/.exec(text);
              if (match !== null) {
                dispatch({
                  hyp: Number(match[1]),
                  id: node.id,
                  type: "setHyp",
                });
              }
            }}
            onSelect={select}
            selected={false}
            value={`#${String(node.hyp)}`}
          />
        ) : (
          <EditableField
            className="tree-edit tree-rule"
            editable={true}
            error={undefined}
            onInput={(text) =>
              dispatch({ id: node.id, text, type: "setRule" })
            }
            onSelect={select}
            selected={false}
            value={node.rule}
          />
        )}
      </proof-inference>
    </proof-tree>
  );
}

function Editor(props: {
  readonly canRedo: boolean;
  readonly canUndo: boolean;
  readonly dispatch: (action: Action) => void;
  readonly doc: Doc;
  readonly onNodeKeyDown: (event: KeyboardEvent, id: string) => void;
  readonly onRedo: () => void;
  readonly onSelect: (id: string) => void;
  readonly onUndo: () => void;
  readonly registerNode: (id: string, el: HTMLElement | null) => void;
  readonly status: Status;
  readonly t: Translate;
}): preact.JSX.Element {
  const { canRedo, canUndo, dispatch, doc, t } = props;
  const { onNodeKeyDown, onRedo, onSelect, onUndo } = props;
  const { registerNode, status } = props;
  const selected = locate(doc.model, doc.selectedId);
  const canBranch = selected !== null && selected.node.hyp === null;
  const canDelete = selected !== null && selected.parentId !== null;

  return (
    <>
      <div class="tree-toolbar">
        <button
          disabled={!canBranch}
          onClick={() => dispatch({ hyp: null, type: "addPremise" })}
          type="button"
        >
          {t("Add premise")}
        </button>
        <button
          disabled={!canBranch}
          onClick={() => dispatch({ hyp: 1, type: "addPremise" })}
          type="button"
        >
          {t("Add hypothesis")}
        </button>
        <button
          disabled={!canDelete}
          onClick={() => dispatch({ type: "delete" })}
          type="button"
        >
          {t("Delete")}
        </button>
        <button
          disabled={!canUndo}
          onClick={onUndo}
          title={t("Undo (Ctrl-Z)")}
          type="button"
        >
          {t("Undo")}
        </button>
        <button
          disabled={!canRedo}
          onClick={onRedo}
          title={t("Redo (Ctrl-Y)")}
          type="button"
        >
          {t("Redo")}
        </button>
      </div>
      {/* The role is on the scroll container; the items are the treeitems. */}
      <div aria-label={t("Proof tree")} class="proof-tree-canvas" role="tree">
        <NodeView
          dispatch={dispatch}
          isRoot={true}
          node={doc.model}
          nodeErrors={status.nodeErrors}
          onNodeKeyDown={onNodeKeyDown}
          onSelect={onSelect}
          registerNode={registerNode}
          selectedId={doc.selectedId}
        />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// The custom element: owns the document, runs the compile side-effect, and
// mounts the Preact island into the server-rendered shadow root.
// ---------------------------------------------------------------------------

class AufbauProofTree extends CarnapExerciseElement<AufbauProofTreeStringId> {
  private mm0 = "";
  private goalName = "";
  private doc: Doc = {
    model: { formula: "", hyp: null, id: uid(), premises: [], rule: "" },
    selectedId: "",
  };
  private status: Status = { mark: "idle", markTitle: "", nodeErrors: {} };
  /**
   * The island's translator, bound once: the toolbar components live outside the
   * element, so they take text as a prop rather than reaching for the payload.
   * Not `translate` — `HTMLElement` already owns that name, as the boolean
   * behind the `translate` attribute.
   */
  private readonly localize: Translate = (id) => this.t(id);
  // Undo/redo over the immutable document. `past`/`future` hold whole `Doc`
  // snapshots; `coalesceKey` collapses a run of same-field keystrokes into one
  // undo step. Selection-only changes never enter history.
  private past: Doc[] = [];
  private future: Doc[] = [];
  private coalesceKey: string | null = null;
  // Live map of node id → its focusable treeitem element, kept via ref
  // callbacks so keyboard navigation can move DOM focus to a chosen node.
  private nodeRefs = new Map<string, HTMLElement>();
  private listeners = new AbortController();
  private mount: HTMLElement | null = null;
  /** Built once in {@link enhance}; see {@link showHelp} for where it lives. */
  private helpDialog: HTMLDialogElement | null = null;
  private proofText = "";
  private lineSpans: readonly { from: number; nodeId: string; to: number }[] =
    [];
  private mmb = "";
  private compileToken = 0;
  private debounceHandle: ReturnType<typeof setTimeout> | null = null;

  protected enhance(): void {
    const root = this.shadowRoot;
    const data = this.publicData;

    // No DSD, wrong mode, or bad data: leave the inert SSR seed in place.
    if (root === null || this.mode !== "answer" || !isTreePublicData(data)) {
      return;
    }

    this.mm0 = data.mm0;
    this.goalName = data.goalName;

    const container = root.querySelector<HTMLElement>(".proof-tree");
    if (container === null) {
      return;
    }

    const style = document.createElement("style");
    style.textContent = SHADOW_STYLES;
    root.appendChild(style);

    // A restored submission wins; otherwise an author-provided starter tree
    // seeds the editor; otherwise a bare root holding just the goal. `deserialize`
    // re-mints every id, keeping the whole-document unique-id invariant.
    const prior = this.priorAnswer as { tree?: unknown } | null;
    const starter = (data as { starterTree?: unknown }).starterTree;
    let model: TreeNode;
    if (prior !== null && isProofTreeNode(prior.tree)) {
      model = deserialize(prior.tree);
    } else if (isProofTreeNode(starter)) {
      model = deserialize(starter);
    } else {
      model = {
        formula: data.goalFormula,
        hyp: null,
        id: uid(),
        premises: [],
        rule: "",
      };
    }
    this.doc = { model, selectedId: model.id };

    // Replace the inert SSR seed with a live mount between the prompt and the
    // action bar, and drop the busy flag now that JS owns the canvas.
    container.removeAttribute("aria-busy");
    root.querySelector(".proof-tree-canvas")?.remove();
    const actionsSlot = container.querySelector(
      'slot[name="exercise-actions"]',
    );
    this.mount = document.createElement("div");
    container.insertBefore(this.mount, actionsSlot);
    this.rerender();

    // Route Ctrl/Cmd-Z / -Y / -Shift-Z through our history rather than the
    // browser's per-field contenteditable undo, which would revert a field's
    // text without reverting the model and desync the two.
    container.addEventListener("keydown", (event) => this.onKeyDown(event), {
      signal: this.listeners.signal,
    });

    // A sibling of the fieldset, not a child of it — the listener just above
    // would otherwise see a Ctrl-Z typed while the help is open and undo the
    // proof behind it. Outside the container it also keeps the dialog's own
    // Escape away from the "step out of the field" branch.
    this.helpDialog = createHelpDialog({
      close: this.t("Close help"),
      intro: INTRO_IDS.map((id) => this.t(id)),
      keyboard: this.t("Keyboard"),
      shortcuts: SHORTCUTS.map((shortcut) => ({
        action: this.t(shortcut.action),
        keys: shortcut.keys,
      })),
      title: this.t("Using the proof tree editor"),
    });
    root.appendChild(this.helpDialog);

    // The `(?)` that opens it goes in the exercise's action bar, in light DOM —
    // one place for every type, and out of reach of the island's rerenders, so
    // focus can be handed back to the very button that was pressed.
    mountHelpTrigger(
      this,
      this.t("Usage and keyboard shortcuts"),
      this.showHelp,
    );

    this.dataset.enhanced = "true";
    this.onModelChanged();
  }

  disconnectedCallback(): void {
    this.listeners.abort();
    if (this.debounceHandle !== null) {
      clearTimeout(this.debounceHandle);
    }
    if (this.mount !== null) {
      render(null, this.mount);
    }
  }

  /**
   * Open the instructions beside whichever control asked for them — the `(?)` in
   * the action bar, or the `?` key on a focused line, which is the route a reader
   * working entirely from the keyboard is likelier to find.
   */
  private readonly showHelp = (trigger: HTMLElement): void => {
    if (this.helpDialog !== null) {
      openHelpDialog(this.helpDialog, trigger);
    }
  };

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      // Editing a field: step back out to its node (nav mode) on Escape. The
      // conclusion field sits inside the treeitem; the rule field is a sibling
      // (outside it), so fall back to the owning proof-tree's treeitem.
      const target = event.target as HTMLElement | null;
      if (target?.classList.contains("tree-edit") === true) {
        event.preventDefault();
        const node =
          target.closest<HTMLElement>(".tree-node") ??
          target
            .closest("proof-tree")
            ?.querySelector<HTMLElement>(
              ":scope > proof-proposition .tree-node",
            );
        node?.focus();
      }
      return;
    }
    if (!(event.ctrlKey || event.metaKey)) {
      return;
    }
    const key = event.key.toLowerCase();
    if (key === "z" && !event.shiftKey) {
      event.preventDefault();
      this.undo();
    } else if ((key === "z" && event.shiftKey) || key === "y") {
      event.preventDefault();
      this.redo();
    }
  }

  protected getAnswer(): unknown {
    return {
      mmb: this.mmb,
      proofText: this.proofText,
      tree: serialize(this.doc.model),
    };
  }

  /** The certificate is compiled from the proof, not typed by the reader. */
  protected override authoredAnswer(): string {
    return JSON.stringify(withoutCertificate(this.getAnswer()));
  }

  private readonly dispatch = (action: Action): void => {
    const previous = this.doc;
    const next = docReducer(previous, action);
    if (next === previous) {
      return;
    }

    if (next.model !== previous.model) {
      // A real edit: record it for undo unless it coalesces with the last one
      // (a run of keystrokes in the same field), and drop any redo branch.
      const key = coalesceKeyFor(action);
      if (key === null || key !== this.coalesceKey) {
        this.pushHistory(previous);
      }
      this.coalesceKey = key;
      this.future = [];
    } else {
      // Selection moved without editing: no history entry, but the next
      // keystroke should start a fresh undo step rather than coalescing.
      this.coalesceKey = null;
    }

    this.doc = next;
    this.rerender();
    if (next.model !== previous.model) {
      this.onModelChanged();
    }
  };

  private pushHistory(snapshot: Doc): void {
    this.past.push(snapshot);
    if (this.past.length > HISTORY_LIMIT) {
      this.past.shift();
    }
  }

  private readonly undo = (): void => {
    const snapshot = this.past.pop();
    if (snapshot === undefined) {
      return;
    }
    this.future.push(this.doc);
    this.doc = snapshot;
    this.coalesceKey = null;
    this.rerender();
    this.onModelChanged();
  };

  private readonly redo = (): void => {
    const snapshot = this.future.pop();
    if (snapshot === undefined) {
      return;
    }
    this.past.push(this.doc);
    this.doc = snapshot;
    this.coalesceKey = null;
    this.rerender();
    this.onModelChanged();
  };

  private readonly selectNode = (id: string): void => {
    this.dispatch({ id, type: "select" });
  };

  private readonly registerNode = (
    id: string,
    el: HTMLElement | null,
  ): void => {
    if (el === null) {
      this.nodeRefs.delete(id);
    } else {
      this.nodeRefs.set(id, el);
    }
  };

  /** Move both selection and DOM focus to `id` (its treeitem), if it exists. */
  private focusNode(id: string): void {
    this.dispatch({ id, type: "select" });
    this.nodeRefs.get(id)?.focus();
  }

  /**
   * Keyboard model: a node's treeitem holds the roving focus. Arrows move
   * between nodes (premises render *above* their parent, so Up steps into the
   * first premise and Down to the parent; Left/Right are siblings). Enter drops
   * into the conclusion field to edit; r drops into the rule/inference field;
   * p / h add a premise or hypothesis; Delete removes the subtree. While editing
   * a field, only Escape is intercepted (to step back out to the node);
   * everything else types normally.
   */
  private onTreeKeyDown(event: KeyboardEvent, nodeId: string): void {
    const located = locate(this.doc.model, nodeId);
    if (located === null) {
      return;
    }
    const { node, parentId } = located;
    const parent =
      parentId === null ? null : locate(this.doc.model, parentId);

    switch (event.key) {
      case "ArrowUp": {
        const first = node.premises[0];
        if (first !== undefined) {
          event.preventDefault();
          this.focusNode(first.id);
        }
        break;
      }
      case "ArrowDown":
        if (parentId !== null) {
          event.preventDefault();
          this.focusNode(parentId);
        }
        break;
      case "ArrowLeft":
      case "ArrowRight": {
        if (parent === null) {
          break;
        }
        const siblings = parent.node.premises;
        const index = siblings.findIndex((child) => child.id === nodeId);
        const next =
          event.key === "ArrowLeft"
            ? siblings[index - 1]
            : siblings[index + 1];
        if (next !== undefined) {
          event.preventDefault();
          this.focusNode(next.id);
        }
        break;
      }
      case "Enter": {
        event.preventDefault();
        this.nodeRefs
          .get(nodeId)
          ?.querySelector<HTMLElement>(".tree-edit")
          ?.focus();
        break;
      }
      case "r":
      case "R": {
        // Edit the rule/inference label. It lives in a sibling <proof-inference>
        // (outside the treeitem), so reach it via the owning <proof-tree>. Esc
        // steps back out, same as the conclusion field.
        event.preventDefault();
        this.nodeRefs
          .get(nodeId)
          ?.closest("proof-tree")
          ?.querySelector<HTMLElement>(":scope > proof-inference .tree-rule")
          ?.focus();
        break;
      }
      case "p":
      case "P":
        if (node.hyp === null) {
          event.preventDefault();
          this.dispatch({ hyp: null, type: "addPremise" });
          this.focusNode(this.doc.selectedId);
        }
        break;
      case "h":
      case "H":
        if (node.hyp === null) {
          event.preventDefault();
          this.dispatch({ hyp: 1, type: "addPremise" });
          this.focusNode(this.doc.selectedId);
        }
        break;
      case "Delete":
      case "Backspace":
        if (parentId !== null) {
          event.preventDefault();
          this.dispatch({ type: "delete" });
          this.focusNode(this.doc.selectedId);
        }
        break;
      case "?": {
        // Anchor to the focused line, which is where the reader is looking.
        // Focus returns here when the dialog closes.
        const anchor = this.nodeRefs.get(nodeId);
        if (anchor !== undefined) {
          event.preventDefault();
          this.showHelp(anchor);
        }
        break;
      }
      default:
        break;
    }
  }

  /**
   * Merge transient compile feedback into the island's state.
   *
   * `nodeErrors` is rendered by the island (each node draws its own complaint);
   * the verdict is rendered by the shared correctness mark in the action bar,
   * which is outside this shadow root and so outside Preact's reach. One method
   * still owns both, because they are one status: every call site sets them
   * together, and a verdict that disagreed with the node errors under it would
   * be a bug nobody could see.
   */
  private setStatus(patch: Partial<Status>): void {
    this.status = { ...this.status, ...patch };
    this.setMark(this.status.mark, this.status.markTitle);
    this.rerender();
  }

  private rerender(): void {
    if (this.mount === null) {
      return;
    }
    render(
      <Editor
        canRedo={this.future.length > 0}
        canUndo={this.past.length > 0}
        dispatch={this.dispatch}
        doc={this.doc}
        onNodeKeyDown={(event, id) => this.onTreeKeyDown(event, id)}
        onRedo={this.redo}
        onSelect={this.selectNode}
        onUndo={this.undo}
        registerNode={this.registerNode}
        status={this.status}
        t={this.localize}
      />,
      this.mount,
    );
  }

  private onModelChanged(): void {
    const flattened = flattenProofTree(
      serialize(this.doc.model),
      this.goalName,
    );
    this.proofText = flattened.proofText;
    this.lineSpans = flattened.lineSpans;
    this.mmb = "";
    this.syncAnswer();
    this.scheduleCompile();
  }

  private scheduleCompile(): void {
    if (this.debounceHandle !== null) {
      clearTimeout(this.debounceHandle);
    }
    this.setStatus({ mark: "working" });
    this.debounceHandle = setTimeout(() => {
      void this.compile();
    }, DEBOUNCE_MS);
  }

  private async compile(): Promise<void> {
    const token = ++this.compileToken;
    const proof = this.proofText;

    let compiler: LoadedCompiler;
    try {
      compiler = await loadProofCompiler();
    } catch {
      if (token === this.compileToken) {
        this.setStatus({
          mark: "error",
          markTitle: this.t("Could not load the proof engine."),
        });
      }
      return;
    }

    if (token !== this.compileToken) {
      return;
    }

    let result: CompileResult;
    try {
      result = compiler.compile(this.mm0, proof);
    } catch {
      if (token !== this.compileToken) {
        return;
      }
      this.mmb = "";
      this.setStatus({ mark: "idle", markTitle: "", nodeErrors: {} });
      this.syncAnswer();
      return;
    }

    if (token !== this.compileToken) {
      return;
    }

    const nodeErrors = this.collectNodeErrors(result, proof);
    if (result.ok === true && result.mmbBytes !== undefined) {
      this.mmb = bytesToBase64(result.mmbBytes);
      this.setStatus({ mark: "ok", markTitle: "", nodeErrors });
    } else {
      this.mmb = "";
      this.setStatus({ mark: "idle", markTitle: "", nodeErrors });
    }
    this.syncAnswer();
  }

  /**
   * Attribute each compiler diagnostic (a UTF-8 byte span into the flattened
   * proof) to the tree node whose generated line contains it, via the
   * flattener's line map, returning a node-id → joined-message map the view
   * renders as inline squiggles.
   */
  private collectNodeErrors(
    result: CompileResult,
    proof: string,
  ): Record<string, string> {
    // Every node error is a reason, and `terse` and `none` withhold reasons.
    // Caught here rather than at the three call sites so a fourth cannot miss
    // it; the compile itself still runs, because the certificate depends on it.
    if (!this.showsDetail) {
      return {};
    }

    const raw = result.diagnostics;
    if (!Array.isArray(raw)) {
      return {};
    }

    const messages = new Map<string, string[]>();
    for (const item of raw) {
      if (typeof item !== "object" || item === null) {
        continue;
      }
      const record = item as { message?: unknown; spanStart?: unknown };
      const message =
        typeof record.message === "string"
          ? record.message
          : this.t("Problem here.");
      const charIndex =
        typeof record.spanStart === "number"
          ? byteToCharIndex(proof, record.spanStart)
          : -1;
      const span =
        charIndex >= 0
          ? this.lineSpans.find(
              (entry) => charIndex >= entry.from && charIndex <= entry.to,
            )
          : undefined;
      const nodeId = span?.nodeId ?? this.doc.model.id;
      const list = messages.get(nodeId) ?? [];
      list.push(message);
      messages.set(nodeId, list);
    }

    const errors: Record<string, string> = {};
    for (const [nodeId, list] of messages) {
      errors[nodeId] = list.join("\n");
    }
    return errors;
  }
}

register("carnap-aufbau-proof-tree", AufbauProofTree);
