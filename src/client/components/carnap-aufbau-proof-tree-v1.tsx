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
 * deletes the selected subtree. A hypothesis leaf is a *citation* of one of the
 * goal's hypotheses, not a line: its text is the cited hypothesis, read from the
 * goal declaration and never typed, and its inference slot is the choice of
 * which one (a select when the goal offers more than one). The tree is drawn by
 * the vendored ProofML custom
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
 * offending line. The debounce, the superseding compile, the certificate and
 * the submit gate are `./proof-element.ts`, shared with the other three.
 */

import { render } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import type { CorrectnessMarkState } from "../../worker/exercise-kit/correctness-mark";
import type {
  NodeFormulaProblem,
  ProofFormulaReader,
  ProofRuleReader,
} from "../../worker/exercise-kit/proof/formulas";
import {
  ENGINE_RULE,
  ENGINE_TEXT,
  goalHypothesisTexts,
  hasTheoryText,
  proofFormulaReader,
  proofRuleReader,
  proofTheoryText,
} from "../../worker/exercise-kit/proof/formulas";
import type { PlaygroundGoal } from "../../worker/exercise-kit/proof/playground";
import {
  playgroundGoal,
  playgroundGoalText,
  playgroundTheoryText,
} from "../../worker/exercise-kit/proof/playground";
import { flattenProofTree } from "../../worker/exercises/aufbau-proof-tree/flatten";
import type { AufbauProofTreeStringId } from "../../worker/exercises/aufbau-proof-tree/strings";
import type {
  AufbauProofTreePublicData,
  ProofTreeNode,
} from "../../worker/exercises/aufbau-proof-tree/types";
import { byteToCharIndex, type CompileDiagnostic } from "../proof-compiler";
import { register } from "./base";
import shadowStyles from "./carnap-aufbau-proof-tree-v1.css" with {
  type: "text",
};
import {
  createHelpDialog,
  HELP_DIALOG_STYLES,
  mountHelpTrigger,
  openHelpDialog,
} from "./help-dialog";
import { ProofExerciseElement } from "./proof-element";
import goalStyles from "./proof-goal.css" with { type: "text" };
import { ToolbarIcon } from "./toolbar-icon";
import { TOOLBAR_STYLES, type ToolbarIconName } from "./toolbar-icons";
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

const HISTORY_LIMIT = 100;

/**
 * Interface text for the island's components. The toolbar and mark are plain
 * functions outside the element, so they receive the lookup as a prop instead of
 * reaching into the hydration payload themselves.
 */
type Translate = (
  id: AufbauProofTreeStringId,
  values?: Readonly<Record<string, number | string>>,
) => string;

function isTreePublicData(
  value: unknown,
): value is AufbauProofTreePublicData {
  return (
    typeof value === "object" &&
    value !== null &&
    hasTheoryText(value) &&
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
  /** Rules admitted with `sorry!`, where the exercise allows it: drawn on the
   *  rule field, since that is where the admission is. */
  readonly nodeWarnings: Readonly<Record<string, string>>;
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

/**
 * What a hypothesis leaf citing `#hyp` shows: the goal's hypothesis of that
 * number, or `""` where the goal has none (a starter or restored tree can cite
 * past the end, and the leaf's error marker says so).
 */
function hypothesisText(hyp: number, hypotheses: readonly string[]): string {
  return hypotheses[hyp - 1] ?? "";
}

/**
 * Every hypothesis leaf's text made to agree with the goal. A restored or
 * starter tree carries the text its leaves had when it was written, which is
 * whatever that editor showed; the goal is what they cite, so the goal is what
 * they show.
 */
function withHypothesisTexts(
  node: TreeNode,
  hypotheses: readonly string[],
): TreeNode {
  if (node.hyp !== null) {
    const formula = hypothesisText(node.hyp, hypotheses);
    return formula === node.formula ? node : { ...node, formula };
  }
  let changed = false;
  const premises = node.premises.map((child) => {
    const next = withHypothesisTexts(child, hypotheses);
    changed = changed || next !== child;
    return next;
  });
  return changed ? { ...node, premises } : node;
}

function seedChild(
  hyp: number | null,
  hypotheses: readonly string[],
): TreeNode {
  return {
    formula: hyp === null ? "" : hypothesisText(hyp, hypotheses),
    hyp,
    id: uid(),
    premises: [],
    rule: "",
  };
}

/**
 * The undo key for an action, or null if the edit must stand alone in history.
 * Consecutive text edits to the *same* field share a key so a run of keystrokes
 * collapses into one undo step; structural edits (add/delete) and a hypothesis
 * choice, which is one pick rather than a run of keystrokes, never coalesce.
 */
function coalesceKeyFor(action: Action): string | null {
  switch (action.type) {
    case "setFormula":
    case "setRule":
      return `${action.type}:${action.id}`;
    default:
      return null;
  }
}

function docReducer(
  doc: Doc,
  action: Action,
  hypotheses: readonly string[],
): Doc {
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
      // The text follows the citation: a leaf shows what it cites.
      const model = replaceNode(doc.model, action.id, (node) =>
        node.hyp === action.hyp
          ? node
          : {
              ...node,
              formula: hypothesisText(action.hyp, hypotheses),
              hyp: action.hyp,
            },
      );
      return model === doc.model ? doc : { ...doc, model };
    }

    case "addPremise": {
      const selected = locate(doc.model, doc.selectedId);
      if (selected === null || selected.node.hyp !== null) {
        return doc;
      }
      // Nothing to cite is nothing to add; the toolbar and the `h` key are
      // both disabled on this condition, and the reducer holds it too.
      if (action.hyp !== null && hypotheses.length === 0) {
        return doc;
      }
      const child = seedChild(action.hyp, hypotheses);
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

const SHADOW_STYLES = [
  shadowStyles,
  goalStyles,
  TOOLBAR_STYLES,
  HELP_DIALOG_STYLES,
].join("\n");

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
  readonly icon?: ToolbarIconName;
  readonly keys: readonly string[];
}[] = [
  { action: "Move between lines", keys: ["↑", "↓", "←", "→"] },
  { action: "Edit the line's formula", keys: ["Enter"] },
  { action: "Edit the line's rule", keys: ["r"] },
  { action: "Leave the field and go back to the line", keys: ["Esc"] },
  { action: "Add a premise above the line", icon: "add-above", keys: ["p"] },
  {
    action: "Add a hypothesis above the line",
    icon: "add-assumption-above",
    keys: ["h"],
  },
  {
    action: "Delete the line and everything above it",
    icon: "delete",
    keys: ["Del"],
  },
  { action: "Undo", icon: "undo", keys: ["Ctrl-Z"] },
  { action: "Redo", icon: "redo", keys: ["Ctrl-Y"] },
  { action: "Open this help", keys: ["?"] },
];

const INTRO_IDS: readonly AufbauProofTreeStringId[] = [
  "The goal sits at the bottom. Click any line to select it, then Add premise to grow the proof upward.",
  "Type the rule that justifies each inference in the field beneath its line. Add hypothesis makes a leaf that cites one of the goal's hypotheses.",
  "The mark beside the Submit button shows whether the proof checks. A line with a problem is underlined; hover it to read what is wrong.",
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
  readonly warning?: string | undefined;
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
    props.error === undefined && props.warning !== undefined
      ? "is-warning"
      : "",
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
      title={props.error ?? props.warning}
    />
  );
}

/**
 * A hypothesis leaf's inference slot: which of the goal's hypotheses it cites.
 * A select when there is a choice to make, each option numbered the way the
 * citation is and worded the way the hypothesis is; plain `#1` when there is
 * not, since a control with one setting is a label that costs a click.
 *
 * The select is drawn as the label `#n` and nothing more, with the native
 * control laid invisibly over it: the leaf already shows the hypothesis's
 * text, and a closed select showing "#2 p → q" beside it would say everything
 * twice and run into the next premise's bar. The options carry the text, so
 * the list that opens reads as a choice between hypotheses, and a reader of
 * the control hears the same. Carries `tree-rule` so the `r` key reaches it
 * as it reaches a rule field; Esc steps out of it the same way (see
 * `onKeyDown`).
 */
function HypothesisChoice(props: {
  readonly hyp: number;
  readonly hypotheses: readonly string[];
  readonly onChoose: (hyp: number) => void;
  readonly onSelect: () => void;
  readonly t: Translate;
}): preact.JSX.Element {
  const { hyp, hypotheses, onChoose, onSelect, t } = props;

  if (hypotheses.length <= 1) {
    return <span class="tree-rule tree-hypothesis-ref">#{hyp}</span>;
  }

  return (
    <span class="tree-hypothesis-pick">
      <span aria-hidden="true" class="tree-hypothesis-ref">
        #{hyp}
      </span>
      <select
        aria-label={t("Cited hypothesis")}
        class="tree-rule tree-hypothesis-choice"
        onChange={(event) => onChoose(Number(event.currentTarget.value))}
        onFocus={onSelect}
        tabIndex={-1}
        value={String(hyp)}
      >
        {hypotheses.map((text, index) => (
          <option key={`${index}:${text}`} value={String(index + 1)}>
            #{index + 1} {text}
          </option>
        ))}
        {hypotheses[hyp - 1] === undefined ? (
          <option value={String(hyp)}>#{hyp}</option>
        ) : null}
      </select>
    </span>
  );
}

function NodeView(props: {
  readonly dispatch: (action: Action) => void;
  /** The root's formula is the fixed goal — except in a playground, where the
   *  root is the student's to write and the goal follows it. */
  readonly fixedRoot: boolean;
  /** The goal's hypotheses, in the order `#n` counts them. */
  readonly hypotheses: readonly string[];
  readonly isRoot: boolean;
  readonly node: TreeNode;
  readonly nodeErrors: Readonly<Record<string, string>>;
  readonly nodeWarnings: Readonly<Record<string, string>>;
  readonly onNodeKeyDown: (event: KeyboardEvent, id: string) => void;
  readonly onSelect: (id: string) => void;
  readonly registerNode: (id: string, el: HTMLElement | null) => void;
  readonly selectedId: string;
  readonly t: Translate;
}): preact.JSX.Element {
  const { dispatch, fixedRoot, hypotheses, isRoot, node, nodeErrors } = props;
  const { nodeWarnings, onNodeKeyDown, onSelect, registerNode } = props;
  const { selectedId, t } = props;
  const isHyp = node.hyp !== null;
  // A hypothesis leaf's text is the cited hypothesis, the goal's to state and
  // not the student's to edit — the same fixed treatment as the goal root.
  const fixed = (isRoot && fixedRoot) || isHyp;
  // A citation past the goal's last hypothesis: a starter or restored tree
  // whose goal changed under it. The compiler's complaint lands on the parent
  // (the leaf owns no line), so the leaf says so itself.
  const hypError =
    node.hyp !== null && hypotheses[node.hyp - 1] === undefined
      ? t("The goal has no hypothesis #{n}", { n: node.hyp })
      : undefined;
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
              fixedRoot={fixedRoot}
              hypotheses={hypotheses}
              isRoot={false}
              node={child}
              nodeErrors={nodeErrors}
              nodeWarnings={nodeWarnings}
              onNodeKeyDown={onNodeKeyDown}
              onSelect={onSelect}
              registerNode={registerNode}
              selectedId={selectedId}
              t={t}
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
            className={[
              "tree-edit",
              fixed ? "tree-fixed" : "",
              isHyp ? "tree-hypothesis" : "",
            ]
              .filter((cls) => cls.length > 0)
              .join(" ")}
            editable={!fixed}
            error={nodeErrors[node.id] ?? hypError}
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
        {node.hyp !== null ? (
          <HypothesisChoice
            hyp={node.hyp}
            hypotheses={hypotheses}
            onChoose={(hyp) => dispatch({ hyp, id: node.id, type: "setHyp" })}
            onSelect={select}
            t={t}
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
            warning={nodeWarnings[node.id]}
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
  /** The goal's hypotheses, in the order `#n` counts them; empty where the
   *  goal declares none, which is what disables Add hypothesis. */
  readonly hypotheses: readonly string[];
  readonly onNodeKeyDown: (event: KeyboardEvent, id: string) => void;
  readonly onRedo: () => void;
  readonly onSelect: (id: string) => void;
  /** An edit run from the toolbar: applies it and focuses the node it made. */
  readonly onToolbarEdit: (action: Action) => void;
  readonly onUndo: () => void;
  /** In a playground, the statement the tree currently proves; `null` for an
   *  ordinary exercise, whose goal is the fixed root. */
  readonly proves: string | null;
  readonly registerNode: (id: string, el: HTMLElement | null) => void;
  readonly status: Status;
  readonly t: Translate;
}): preact.JSX.Element {
  const { canRedo, canUndo, dispatch, doc, hypotheses, proves, t } = props;
  const { onNodeKeyDown, onRedo, onSelect, onUndo } = props;
  const { onToolbarEdit, registerNode, status } = props;
  const selected = locate(doc.model, doc.selectedId);
  const canBranch = selected !== null && selected.node.hyp === null;
  // A hypothesis leaf cites one of the goal theorem's hypotheses, so there
  // has to be one: a sequent-style goal keeps its assumptions left of the
  // turnstile and declares none, and a playground has no goal at all.
  const canHypothesis = canBranch && hypotheses.length > 0;
  const canDelete = selected !== null && selected.parentId !== null;

  return (
    <>
      {proves === null ? null : (
        <div class="proof-goal">
          <span class="proof-goal-label">{t("Proves")}</span>{" "}
          <span class="proof-goal-statement">{proves}</span>
        </div>
      )}
      {/* Icon-only: the name is the aria-label, the tooltip adds the key,
          and the help dialog's legend is where the glyphs are explained. See
          toolbar-icons.ts for why there are no words here. */}
      <div class="proof-toolbar tree-toolbar">
        <button
          aria-label={t("Add premise")}
          disabled={!canBranch}
          onClick={() => onToolbarEdit({ hyp: null, type: "addPremise" })}
          title={t("Add premise (p)")}
          type="button"
        >
          <ToolbarIcon name="add-above" />
        </button>
        <button
          aria-label={t("Add hypothesis")}
          disabled={!canHypothesis}
          onClick={() => onToolbarEdit({ hyp: 1, type: "addPremise" })}
          title={t("Add hypothesis (h)")}
          type="button"
        >
          <ToolbarIcon name="add-assumption-above" />
        </button>
        <button
          aria-label={t("Delete")}
          disabled={!canDelete}
          onClick={() => onToolbarEdit({ type: "delete" })}
          title={t("Delete (Del)")}
          type="button"
        >
          <ToolbarIcon name="delete" />
        </button>
        <span aria-hidden="true" class="proof-toolbar-sep" />
        <button
          aria-label={t("Undo")}
          disabled={!canUndo}
          onClick={onUndo}
          title={t("Undo (Ctrl-Z)")}
          type="button"
        >
          <ToolbarIcon name="undo" />
        </button>
        <button
          aria-label={t("Redo")}
          disabled={!canRedo}
          onClick={onRedo}
          title={t("Redo (Ctrl-Y)")}
          type="button"
        >
          <ToolbarIcon name="redo" />
        </button>
      </div>
      {/* The role is on the scroll container; the items are the treeitems. */}
      <div aria-label={t("Proof tree")} class="proof-tree-canvas" role="tree">
        <NodeView
          dispatch={dispatch}
          fixedRoot={proves === null}
          hypotheses={hypotheses}
          isRoot={true}
          node={doc.model}
          nodeErrors={status.nodeErrors}
          nodeWarnings={status.nodeWarnings}
          onNodeKeyDown={onNodeKeyDown}
          onSelect={onSelect}
          registerNode={registerNode}
          selectedId={doc.selectedId}
          t={t}
        />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// The custom element: owns the document, runs the compile side-effect, and
// mounts the Preact island into the server-rendered shadow root.
// ---------------------------------------------------------------------------

class AufbauProofTree extends ProofExerciseElement<AufbauProofTreeStringId> {
  /** The frozen theory: with the goal appended for an ordinary exercise, and
   *  bare for a playground, whose goal is appended per compile. */
  private theory: { readonly mm0: string; readonly source: string | null } = {
    mm0: "",
    source: null,
  };
  /** A playground derives its goal from the root; see
   *  `exercise-kit/proof/playground.ts`. */
  private playground = false;
  /** The goal the last flattening derived (playground only). */
  private goal: PlaygroundGoal | null = null;
  /** What the next compile runs against; `null` when there is nothing to. */
  private compileMm0: string | null = null;
  /** Reads a node's text in the theory's language; passes it through where
   *  the exercise was frozen without one. See `exercise-kit/proof/formulas.ts`. */
  private readFormula: ProofFormulaReader = ENGINE_TEXT;
  /** Cited rule name to the engine's, from the theory's `@syntax alias` lines. */
  private readRule: ProofRuleReader = ENGINE_RULE;
  private goalName = "";
  /** The goal's hypotheses, what a `#n` leaf cites; read once at connect. */
  private hypotheses: readonly string[] = [];
  private doc: Doc = {
    model: { formula: "", hyp: null, id: uid(), premises: [], rule: "" },
    selectedId: "",
  };
  private status: Status = {
    mark: "idle",
    markTitle: "",
    nodeErrors: {},
    nodeWarnings: {},
  };
  /**
   * The island's translator, bound once: the toolbar components live outside the
   * element, so they take text as a prop rather than reaching for the payload.
   * Not `translate` — `HTMLElement` already owns that name, as the boolean
   * behind the `translate` attribute.
   */
  private readonly localize: Translate = (id, values) => this.t(id, values);
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

  protected enhance(): void {
    const root = this.shadowRoot;
    const data = this.publicData;

    // No DSD, wrong mode, or bad data: leave the inert SSR seed in place.
    if (root === null || this.mode !== "answer" || !isTreePublicData(data)) {
      return;
    }

    const theory = proofTheoryText(data);
    this.theory = theory;
    this.playground = data.playground === true;
    this.allowSorry = data.allowSorry === true;
    this.readFormula = proofFormulaReader(
      theory.source,
      "sequent",
      data.goalName,
    );
    this.readRule = proofRuleReader(theory.source);
    this.goalName = data.goalName;
    // A playground appends its goal per compile and it has no hypotheses. An
    // artifact frozen before `source` existed has only the stripped text,
    // which declares the same goal and reads the same way.
    this.hypotheses = this.playground
      ? []
      : goalHypothesisTexts(theory.source ?? theory.mm0, data.goalName);

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
      model = withHypothesisTexts(deserialize(prior.tree), this.hypotheses);
    } else if (isProofTreeNode(starter)) {
      model = withHypothesisTexts(deserialize(starter), this.hypotheses);
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
        ...(shortcut.icon === undefined ? {} : { icon: shortcut.icon }),
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

    this.gateSubmit((event) => this.gate(event));
    this.dataset.enhanced = "true";
    this.onModelChanged();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.listeners.abort();
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
      if (target?.matches(".tree-edit, .tree-hypothesis-choice") === true) {
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
      ...(this.goal === null ? {} : { goal: this.goal }),
      mmb: this.mmb,
      proofText: this.proofText,
      tree: serialize(this.doc.model),
    };
  }

  private readonly dispatch = (action: Action): void => {
    const previous = this.doc;
    const next = docReducer(previous, action, this.hypotheses);
    if (next === previous) {
      return;
    }
    const heldFocus = this.holdsFocus();

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
    this.restoreFocusIfLost(heldFocus);
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
    const heldFocus = this.holdsFocus();
    this.future.push(this.doc);
    this.doc = snapshot;
    this.coalesceKey = null;
    this.rerender();
    this.restoreFocusIfLost(heldFocus);
    this.onModelChanged();
  };

  private readonly redo = (): void => {
    const snapshot = this.future.pop();
    if (snapshot === undefined) {
      return;
    }
    const heldFocus = this.holdsFocus();
    this.past.push(this.doc);
    this.doc = snapshot;
    this.coalesceKey = null;
    this.rerender();
    this.restoreFocusIfLost(heldFocus);
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

  /** Is the reader's focus anywhere inside this exercise's shadow root? */
  private holdsFocus(): boolean {
    return (this.shadowRoot?.activeElement ?? null) !== null;
  }

  /**
   * Put the roving focus back on a node after an edit that took DOM focus with
   * it.
   *
   * Deleting a subtree, or undoing the premise just added, removes the node the
   * reader is standing on: the browser has nowhere to put focus and drops it to
   * the document body, where none of the shortcuts is listening — not even the
   * Ctrl-Z that would undo the undo. So when the exercise held focus before the
   * edit and holds none after, it takes focus back.
   *
   * Conditional on having lost it: a Ctrl-Z typed while a conclusion field has
   * focus rolls back that field's text, and yanking the caret out to the node
   * would make editing unusable.
   */
  private restoreFocusIfLost(heldFocus: boolean): void {
    if (!heldFocus || this.holdsFocus()) {
      return;
    }
    this.nodeRefs.get(this.doc.selectedId)?.focus();
  }

  /**
   * A toolbar edit: apply it, then stand the reader on the node it produced.
   *
   * The buttons duplicate the single-key gestures, which already leave focus on
   * the node they made — and without this the click leaves focus on the button,
   * where every one of those keys does nothing.
   */
  private readonly toolbarEdit = (action: Action): void => {
    this.dispatch(action);
    this.nodeRefs.get(this.doc.selectedId)?.focus();
  };

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
        if (node.hyp === null && this.hypotheses.length > 0) {
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
        hypotheses={this.hypotheses}
        onNodeKeyDown={(event, id) => this.onTreeKeyDown(event, id)}
        onRedo={this.redo}
        onSelect={this.selectNode}
        onToolbarEdit={this.toolbarEdit}
        onUndo={this.undo}
        proves={
          this.playground
            ? this.goal === null
              ? ""
              : playgroundGoalText(this.theory.source, this.goal)
            : null
        }
        registerNode={this.registerNode}
        status={this.status}
        t={this.localize}
      />,
      this.mount,
    );
  }

  /**
   * What the tree compiles against: the frozen text, or — in a playground —
   * the frozen text plus the goal the root makes. `null` when there is
   * nothing to compile: a playground whose root is empty, or whose
   * statement's variables the theory cannot name (the mark says so).
   */
  private compileTheory(
    flattened: ReturnType<typeof flattenProofTree>,
  ): string | null {
    if (!this.playground) {
      return this.theory.mm0;
    }

    const statement =
      flattened.statement === null || flattened.statement.text.trim() === ""
        ? null
        : flattened.statement;
    const goal =
      statement === null
        ? null
        : playgroundGoal(this.theory.source, statement);
    this.goal = goal;

    if (goal === null) {
      this.setStatus(
        statement === null
          ? { mark: "idle", markTitle: "", nodeErrors: {}, nodeWarnings: {} }
          : {
              mark: "error",
              markTitle: this.t(
                "Could not work out what the last line states.",
              ),
              nodeErrors: {},
              nodeWarnings: {},
            },
      );
      return null;
    }

    return playgroundTheoryText(this.theory, goal).mm0;
  }

  private onModelChanged(): void {
    const flattened = flattenProofTree(
      serialize(this.doc.model),
      this.goalName,
      this.readFormula,
      this.readRule,
    );
    this.proofText = flattened.proofText;
    this.lineSpans = flattened.lineSpans;
    this.forgetVerdict();

    // A node the language refused never reaches the compiler: the `.auf` it
    // would produce is the text the student typed, and the unification failure
    // that comes back names none of the characters they got wrong. Show the
    // parser's own complaint against the node instead.
    if (flattened.formulaProblems.length > 0) {
      this.cancelCompile();
      this.goal = null;
      this.syncAnswer();
      this.setStatus({
        mark: "idle",
        markTitle: "",
        nodeErrors: this.formulaNodeErrors(flattened.formulaProblems),
        nodeWarnings: {},
      });
      return;
    }

    // The theory the certificate is compiled against, settled here so the
    // goal row follows every edit rather than the debounced compile.
    this.compileMm0 = this.compileTheory(flattened);
    this.syncAnswer();

    if (this.compileMm0 === null) {
      this.cancelCompile();
      return;
    }

    this.setStatus({ mark: "working" });
    this.scheduleCompile();
  }

  /**
   * The language's refusals as the same node-id → message map a compiler
   * diagnostic produces, so the view draws one kind of squiggle. Withheld
   * under `terse`/`none` on the same terms as {@link collectNodeProblems}: a
   * refusal is a reason, and the two must not disagree about that.
   */
  private formulaNodeErrors(
    problems: readonly NodeFormulaProblem[],
  ): Record<string, string> {
    if (!this.showsDetail) {
      return {};
    }

    const errors: Record<string, string> = {};
    for (const problem of problems) {
      const said = this.t(problem.error.message, problem.error.params);
      const already = errors[problem.nodeId];
      errors[problem.nodeId] =
        already === undefined ? said : `${already}\n${said}`;
    }
    return errors;
  }

  protected async compile(): Promise<void> {
    const proof = this.proofText;
    const mm0 = this.compileMm0;

    if (mm0 === null) {
      this.cancelCompile();
      return;
    }

    const run = await this.runCompiler(mm0, proof);
    if (run === null) {
      return;
    }
    if (run.kind === "unavailable") {
      this.setStatus({
        mark: "error",
        markTitle: this.t("Could not load the proof engine."),
      });
      return;
    }
    if (run.kind === "unreadable") {
      this.setStatus({
        mark: "idle",
        markTitle: "",
        nodeErrors: this.compileFailureErrors(),
        nodeWarnings: {},
      });
      this.syncAnswer();
      return;
    }

    const { verdict } = run;
    this.setStatus({
      mark: verdict.certificate !== null ? "ok" : "idle",
      markTitle: "",
      ...this.collectNodeProblems(verdict.problems, proof),
    });
    // An admitted proof also gets the status line: the mark says nothing, and
    // what it is not saying deserves a sentence.
    this.setCheckStatus(this.admittedStatus());
    this.syncAnswer();
  }

  /**
   * The compiler threw before it could report diagnostics. One generic
   * message on the root node, where a diagnostic with no span would land,
   * rather than a blank tree and a spinner that stopped for no stated reason
   * — withheld on the same terms as any other reason.
   */
  private compileFailureErrors(): Record<string, string> {
    if (!this.showsDetail) {
      return {};
    }

    return {
      [this.doc.model.id]: this.t(
        "The proof engine couldn't read this proof — check for unexpected characters.",
      ),
    };
  }

  /**
   * Attribute each compiler diagnostic (a UTF-8 byte span into the flattened
   * proof) to the tree node whose generated line contains it, via the
   * flattener's line map, returning node-id → joined-message maps the view
   * renders as inline squiggles: errors on the formula, warnings (a rule
   * admitted with `sorry!`) on the rule.
   */
  private collectNodeProblems(
    problems: readonly CompileDiagnostic[],
    proof: string,
  ): Pick<Status, "nodeErrors" | "nodeWarnings"> {
    // Every node problem is a reason, and `terse` and `none` withhold reasons.
    // Caught here rather than at the call sites so another cannot miss it;
    // the compile itself still runs, because the certificate depends on it.
    if (!this.showsDetail) {
      return { nodeErrors: {}, nodeWarnings: {} };
    }

    const messages = {
      error: new Map<string, string[]>(),
      warning: new Map<string, string[]>(),
    };
    for (const problem of problems) {
      const message = problem.message ?? this.t("Problem here.");
      const charIndex =
        problem.spanStart !== undefined
          ? byteToCharIndex(proof, problem.spanStart)
          : -1;
      const span =
        charIndex >= 0
          ? this.lineSpans.find(
              (entry) => charIndex >= entry.from && charIndex <= entry.to,
            )
          : undefined;
      const nodeId = span?.nodeId ?? this.doc.model.id;
      const bucket =
        problem.severity === "warning" ? messages.warning : messages.error;
      const list = bucket.get(nodeId) ?? [];
      list.push(message);
      bucket.set(nodeId, list);
    }

    const joined = (
      bucket: Map<string, string[]>,
    ): Record<string, string> => {
      const out: Record<string, string> = {};
      for (const [nodeId, list] of bucket) {
        out[nodeId] = list.join("\n");
      }
      return out;
    };
    return {
      nodeErrors: joined(messages.error),
      nodeWarnings: joined(messages.warning),
    };
  }
}

register("carnap-aufbau-proof-tree", AufbauProofTree);
