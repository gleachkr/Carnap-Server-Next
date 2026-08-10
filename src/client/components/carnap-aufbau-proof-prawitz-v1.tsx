/** @jsxImportSource preact */
/**
 * `<carnap-aufbau-proof-prawitz>` — the interactive *Prawitz* proof editor.
 *
 * Prawitz trees are built **top-down**: the student starts free-standing
 * assumptions, then derives downward — select one or more trees and apply a
 * rule *below* them, turning the selected roots into the premises of a new
 * conclusion. The workspace is therefore a **forest** of independent subtrees
 * (unlike the goal-rooted tree editor, which only grows upward), and the
 * exercise is done when the forest has joined into a single tree whose root is
 * the goal. Backward growth is still available — a premise or assumption can
 * be added *above* a derived node — so a student may also meet in the middle.
 *
 * Discharge is marked exactly as the textbook writes it: an assumption leaf
 * carries a label field (`[A]¹`) and a rule node a discharge field (the `¹`
 * beside the inference line); typing the same label in both is the whole
 * gesture. Because rules are order-sensitive, **selection order is premise
 * order** when applying a rule below — multi-selected roots show their ordinal.
 *
 * The editable document (`{ trees, selected }`) is an *immutable* value driven
 * by a pure reducer, so a re-render is `render(view(doc), mount)` and
 * structural edits (apply/delete, undo/redo) never poke the DOM by hand. Only
 * the contenteditable text fields are *uncontrolled* — Preact renders each once
 * (keyed by node id) and never rewrites its text while it is focused, so the
 * caret survives typing. Preact is used only on the interactive path; on review
 * pages the module still just registers the ProofML elements and no island
 * mounts.
 *
 * Once the forest is a single tree, every edit translates it (`prawitzToAuf`:
 * discharge labels → boxes → dependency sequent contexts) and compiles the `.auf`
 * against the frozen theory with the lazily-loaded `@aufbau/compiler`; the
 * answer mirrored into the form is `{ mmb, proofText, tree }`. As with the
 * sibling types the MMB is the certificate and the worker is the arbiter — the
 * compiler here is an untrusted convenience. A compiler diagnostic (a UTF-8
 * byte span into the translated text) is mapped back through the translator's
 * line map onto the tree node that produced the offending line; the
 * translator's own structural diagnostics (a discharge mark with no matching
 * assumption, mixed formulas under one mark) surface the same way.
 */
import type { CompileResult, LoadedCompiler } from "@aufbau/compiler";
import { render } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import type { AufbauProofPrawitzStringId } from "../../worker/exercises/aufbau-proof-prawitz/strings";
import type { PrawitzDiagnostic } from "../../worker/exercises/aufbau-proof-prawitz/translate";
import { prawitzToAuf } from "../../worker/exercises/aufbau-proof-prawitz/translate";
import type {
  AufbauProofPrawitzPublicData,
  PrawitzProofNode,
} from "../../worker/exercises/aufbau-proof-prawitz/types";
import type { CorrectnessMarkState } from "../../worker/exercises/correctness-mark";
import { CarnapExerciseElement, register, withoutCertificate } from "./base";
import {
  createHelpDialog,
  HELP_DIALOG_STYLES,
  mountHelpTrigger,
  openHelpDialog,
} from "./help-dialog";
import "../vendor/proofml.mjs";

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

const COMPILER_WASM_URL = "/assets/aufbau-compiler.wasm";
const DEBOUNCE_MS = 400;
const HISTORY_LIMIT = 100;

type Translate = (
  id: AufbauProofPrawitzStringId,
  values?: Readonly<Record<string, number | string>>,
) => string;

// ---------------------------------------------------------------------------
// Byte/base64 helpers (shared shape with the sibling editors).
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

function isPrawitzPublicData(
  value: unknown,
): value is AufbauProofPrawitzPublicData {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { mm0?: unknown }).mm0 === "string" &&
    typeof (value as { goalName?: unknown }).goalName === "string" &&
    typeof (value as { goalFormula?: unknown }).goalFormula === "string" &&
    typeof (value as { assumptionRule?: unknown }).assumptionRule === "string"
  );
}

function isPrawitzProofNode(value: unknown): value is PrawitzProofNode {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { formula?: unknown }).formula === "string" &&
    typeof (value as { rule?: unknown }).rule === "string" &&
    Array.isArray((value as { premises?: unknown }).premises)
  );
}

// ---------------------------------------------------------------------------
// The editable document: an immutable forest plus the ordered selection.
// ---------------------------------------------------------------------------

/**
 * Immutable editing node. An assumption is *structural* here (`isAssumption`)
 * rather than "rule text happens to equal the assumption axiom" — the student
 * never types `ax`; serialization writes the exercise's assumption rule in.
 * `discharge` is the raw text of the marks field (`"1, 2"`); it splits on
 * serialize so the field can be uncontrolled.
 */
interface PNode {
  readonly discharge: string;
  readonly formula: string;
  readonly id: string;
  readonly isAssumption: boolean;
  readonly label: string;
  readonly premises: readonly PNode[];
  readonly rule: string;
}

interface Doc {
  /** The forest, left to right. */
  readonly trees: readonly PNode[];
  /** Ordered multi-selection: order = premise order for Apply rule below. */
  readonly selected: readonly string[];
}

/** Transient compile feedback — derived, never part of the undoable document. */
interface Status {
  readonly mark: CorrectnessMarkState;
  readonly markTitle: string;
  readonly nodeErrors: Readonly<Record<string, string>>;
}

type Action =
  | {
      readonly type: "select";
      readonly id: string;
      readonly additive: boolean;
    }
  | {
      readonly type: "setFormula";
      readonly id: string;
      readonly text: string;
    }
  | { readonly type: "setRule"; readonly id: string; readonly text: string }
  | { readonly type: "setLabel"; readonly id: string; readonly text: string }
  | {
      readonly type: "setDischarge";
      readonly id: string;
      readonly text: string;
    }
  | { readonly type: "addAssumption" }
  | { readonly type: "applyBelow" }
  | { readonly type: "addAbove"; readonly assumption: boolean }
  | { readonly type: "delete" };

let idCounter = 0;
function uid(): string {
  idCounter += 1;
  return `n${idCounter}`;
}

/**
 * Rebuild an editing tree from a serialized (prior-answer) tree, minting a
 * *fresh* id for every node rather than trusting the stored ones — ids are
 * ephemeral editing handles, and re-minting keeps the whole-document invariant
 * that every id is unique and drawn from the monotonic counter (the same
 * restored-id collision the tree editor fixed at `09c029f`).
 */
function deserialize(node: PrawitzProofNode, assumptionRule: string): PNode {
  const isAssumption = node.rule === assumptionRule;
  return {
    discharge: (node.discharge ?? []).join(", "),
    formula: node.formula,
    id: uid(),
    isAssumption,
    label: node.label ?? "",
    premises: isAssumption
      ? []
      : node.premises.map((premise) => deserialize(premise, assumptionRule)),
    rule: isAssumption ? "" : node.rule,
  };
}

function serialize(node: PNode, assumptionRule: string): PrawitzProofNode {
  if (node.isAssumption) {
    const label = node.label.trim();
    return {
      formula: node.formula,
      id: node.id,
      ...(label.length === 0 ? {} : { label }),
      premises: [],
      rule: assumptionRule,
    };
  }
  const marks = node.discharge
    .split(/[\s,]+/)
    .map((mark) => mark.trim())
    .filter((mark) => mark.length > 0);
  return {
    ...(marks.length === 0 ? {} : { discharge: marks }),
    formula: node.formula,
    id: node.id,
    premises: node.premises.map((premise) =>
      serialize(premise, assumptionRule),
    ),
    rule: node.rule,
  };
}

/** Find a node anywhere in the forest, with its parent id and root index. */
function locate(
  trees: readonly PNode[],
  id: string,
): { node: PNode; parentId: string | null; rootIndex: number } | null {
  function walk(
    node: PNode,
    parentId: string | null,
    rootIndex: number,
  ): { node: PNode; parentId: string | null; rootIndex: number } | null {
    if (node.id === id) {
      return { node, parentId, rootIndex };
    }
    for (const child of node.premises) {
      const found = walk(child, node.id, rootIndex);
      if (found !== null) {
        return found;
      }
    }
    return null;
  }
  for (const [index, tree] of trees.entries()) {
    const found = walk(tree, null, index);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

/** Structural-sharing node replacement across the whole forest. */
function replaceNode(
  trees: readonly PNode[],
  id: string,
  fn: (node: PNode) => PNode,
): readonly PNode[] {
  function inTree(node: PNode): PNode {
    if (node.id === id) {
      return fn(node);
    }
    let changed = false;
    const premises = node.premises.map((child) => {
      const next = inTree(child);
      if (next !== child) {
        changed = true;
      }
      return next;
    });
    return changed ? { ...node, premises } : node;
  }
  let changed = false;
  const next = trees.map((tree) => {
    const replaced = inTree(tree);
    if (replaced !== tree) {
      changed = true;
    }
    return replaced;
  });
  return changed ? next : trees;
}

function newAssumption(): PNode {
  return {
    discharge: "",
    formula: "",
    id: uid(),
    isAssumption: true,
    label: "",
    premises: [],
    rule: "",
  };
}

/**
 * The tree an emptied workspace serializes as — a constant, not a fresh
 * `newAssumption()`. Reading the answer must not change it, and minting an id
 * per read made two consecutive reads of an untouched workspace differ, which
 * the unsaved-work flag has no way to read as anything but an edit. The id is
 * outside the counter's range and is re-minted on restore anyway.
 */
const EMPTY_TREE: PNode = {
  discharge: "",
  formula: "",
  id: "n0",
  isAssumption: true,
  label: "",
  premises: [],
  rule: "",
};

function newDerived(premises: readonly PNode[]): PNode {
  return {
    discharge: "",
    formula: "",
    id: uid(),
    isAssumption: false,
    label: "",
    premises,
    rule: "",
  };
}

/** Every selected id is the root of a forest tree (the applyBelow guard). */
function selectionIsRoots(doc: Doc): boolean {
  return (
    doc.selected.length > 0 &&
    doc.selected.every((id) => doc.trees.some((tree) => tree.id === id))
  );
}

/**
 * The undo key for an action, or null if the edit must stand alone in history.
 * Consecutive text edits to the *same* field share a key so a run of
 * keystrokes collapses into one undo step; structural edits never coalesce.
 */
function coalesceKeyFor(action: Action): string | null {
  switch (action.type) {
    case "setFormula":
    case "setRule":
    case "setLabel":
    case "setDischarge":
      return `${action.type}:${action.id}`;
    default:
      return null;
  }
}

function setText(
  doc: Doc,
  id: string,
  key: "formula" | "rule" | "label" | "discharge",
  text: string,
): Doc {
  const trees = replaceNode(doc.trees, id, (node) =>
    node[key] === text ? node : { ...node, [key]: text },
  );
  return trees === doc.trees ? doc : { ...doc, trees };
}

function docReducer(doc: Doc, action: Action): Doc {
  switch (action.type) {
    case "select": {
      if (!action.additive) {
        return doc.selected.length === 1 && doc.selected[0] === action.id
          ? doc
          : { ...doc, selected: [action.id] };
      }
      const selected = doc.selected.includes(action.id)
        ? doc.selected.filter((id) => id !== action.id)
        : [...doc.selected, action.id];
      return { ...doc, selected };
    }

    case "setFormula":
      return setText(doc, action.id, "formula", action.text);
    case "setRule":
      return setText(doc, action.id, "rule", action.text);
    case "setLabel":
      return setText(doc, action.id, "label", action.text);
    case "setDischarge":
      return setText(doc, action.id, "discharge", action.text);

    case "addAssumption": {
      const leaf = newAssumption();
      return { selected: [leaf.id], trees: [...doc.trees, leaf] };
    }

    case "applyBelow": {
      if (!selectionIsRoots(doc)) {
        return doc;
      }
      // Premises in *selection* order — rules are order-sensitive — while the
      // new tree takes the leftmost selected root's place in the forest.
      const premises = doc.selected.map(
        (id) => doc.trees.find((tree) => tree.id === id) as PNode,
      );
      const conclusion = newDerived(premises);
      const at = Math.min(
        ...doc.selected.map((id) =>
          doc.trees.findIndex((tree) => tree.id === id),
        ),
      );
      const trees: PNode[] = [];
      for (const [index, tree] of doc.trees.entries()) {
        if (index === at) {
          trees.push(conclusion);
        }
        if (!doc.selected.includes(tree.id)) {
          trees.push(tree);
        }
      }
      return { selected: [conclusion.id], trees };
    }

    case "addAbove": {
      const id = doc.selected.length === 1 ? doc.selected[0] : undefined;
      const located = id === undefined ? null : locate(doc.trees, id);
      if (located === null || located.node.isAssumption) {
        return doc;
      }
      const child = action.assumption ? newAssumption() : newDerived([]);
      const trees = replaceNode(doc.trees, located.node.id, (node) => ({
        ...node,
        premises: [...node.premises, child],
      }));
      // Selection stays on the parent so repeated adds stack siblings in place.
      return { ...doc, trees };
    }

    case "delete": {
      const id = doc.selected.length === 1 ? doc.selected[0] : undefined;
      const located = id === undefined ? null : locate(doc.trees, id);
      if (located === null) {
        return doc;
      }
      // Deleting a derived node is the inverse of applyBelow: its premises are
      // promoted into its place (spliced into the parent, or freed back into
      // the forest). Deleting an assumption just removes the leaf.
      const promoted = located.node.premises;
      if (located.parentId === null) {
        const trees = doc.trees.flatMap((tree) =>
          tree.id === located.node.id ? [...promoted] : [tree],
        );
        const next =
          promoted[0] ?? doc.trees.find((t) => t.id !== located.node.id);
        return { selected: next === undefined ? [] : [next.id], trees };
      }
      const trees = replaceNode(doc.trees, located.parentId, (node) => ({
        ...node,
        premises: node.premises.flatMap((child) =>
          child.id === located.node.id ? [...promoted] : [child],
        ),
      }));
      return { selected: [located.parentId], trees };
    }
  }
}

// ---------------------------------------------------------------------------
// Presentation (Preact).
// ---------------------------------------------------------------------------

const SHADOW_STYLES = `
  ${HELP_DIALOG_STYLES}

  .pz-toolbar {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin: 0.6rem 0 0.2rem;
  }
  .pz-toolbar button {
    background: var(--control-surface, #fbf7ef);
    border: 1px solid var(--rule, #d8d0c3);
    border-radius: 0.3rem;
    color: var(--blue-strong, #074f9f);
    cursor: pointer;
    font: inherit;
    font-size: 0.78rem;
    padding: 0.2rem 0.55rem;
  }
  .pz-toolbar button:disabled {
    color: var(--ink-muted, #5f7388);
    cursor: default;
    opacity: 0.55;
  }
  .pz-goal {
    color: var(--ink-muted, #5f7388);
    font-size: 0.85rem;
    margin: 0.4rem 0 0;
  }
  .pz-goal code {
    color: var(--ink, #16324a);
    font-family: "Fira Code", ui-monospace, monospace;
  }
  /* The forest lays its trees side by side; each is its own derivation. */
  .prawitz-canvas {
    align-items: flex-end;
    display: flex;
    flex-wrap: wrap;
    gap: 0 2.2rem;
    padding-left: 1rem
  }
  .pz-edit {
    border-bottom: 1px dashed transparent;
    /* An atomic inline box, not a run of inline text. This is what makes the
       text caret visible: a root line's .pz-node wrapper is itself inline (its
       proof-proposition is the flex item, so only the proposition gets
       blockified), and Chromium paints no caret in an editable inline box whose
       whole ancestry up to the block container is inline. It showed as a caret
       that vanished the moment anything was typed — an unfilled field is
       .is-empty, which was already inline-block, so the box changed formatting
       context under the reader mid-keystroke. Keeping it inline-block in every
       state fixes the caret and makes filled and empty fields agree.
       Also: min-width has no effect on a non-replaced inline box, so the 1ch
       floor below only starts applying here. */
    display: inline-block;
    /* Fira Code first (loaded as a web font) so its contextual ligatures turn
       typed connectives like -> and <-> into → and ↔ in the rendered proof. */
    font-family: "Fira Code", ui-monospace, monospace;
    min-width: 1ch;
    outline: none;
    padding: 0 0.1rem;
    white-space: pre;
  }
  .pz-edit:focus { border-bottom-color: var(--blue, #0b66d8); }
  .pz-edit.is-selected { background: var(--blue-soft, #eaf3ff); }
  .pz-edit.is-error {
    border-bottom: 1px wavy var(--red, #b42318);
    text-decoration: underline wavy var(--red, #b42318);
  }
  .pz-edit:not(.is-selected):not(.is-empty):hover {
    background: var(--surface-soft, #f8f2e8);
  }
  /* An unfilled field: a tinted, comfortably-clickable box. */
  .pz-edit.is-empty {
    background: var(--blue-soft, #eaf3ff);
    border-bottom-color: transparent;
    border-radius: 0.2rem;
    min-height: 1.15em;
    min-width: 2.6ch;
    outline: 1px dashed var(--blue, #0b66d8);
    outline-offset: 1px;
  }
  .pz-rule.is-empty { min-width: 3.4ch; }
  /* A field with no child nodes at all has no line box, so its baseline is
     its bottom edge and the box rides high on the line — visibly misplacing
     the assumption label hung off the node's corner. A zero-width space
     restores real text metrics. Only the freshly-rendered state needs it:
     after type-then-delete the browser leaves its own placeholder <br>
     behind (that <br> *is* contenteditable's empty state, which is why it
     can't be deleted), and with any child present :empty stops matching. */
  .pz-edit:empty::before { content: "\\200B"; }
  /* Label / discharge marks: superscripts, like the printed notation — kept
     large enough to read and to hit (0.72em proved squint-sized). */
  sup .pz-edit { font-size: 0.85em; }
  sup .pz-edit.is-empty { min-width: 1.6ch; }
  /* The secondary fields stay out of the way until asked for: an *empty* label
     or discharge box shows only on the selected line, so an untouched proof
     isn't studded with blue boxes. A filled one is notation and always shows. */
  .pz-secondary.is-empty { display: none; }
  .pz-current > proof-proposition .pz-secondary.is-empty,
  .pz-current > proof-inference .pz-secondary.is-empty {
    display: inline-block;
  }
  .pz-bracket { font-family: "Fira Code", ui-monospace, monospace; }
  /* An assumption has no inference line above it. ProofML puts a border-top on
     any proposition whose forest is uninhabited (its zero-premise-rule line);
     an outer-tree rule outranks the shadow ::slotted one, so this wins. */
  .pz-assumption > proof-proposition { border-top: none; }
  /* Roving-focus wrapper: carries keyboard focus for tree navigation. */
  .pz-node { border-radius: 0.25rem; outline: none; position: relative; }
  .pz-node:focus-visible {
    outline: 2px solid var(--blue, #0b66d8);
    outline-offset: 2px;
  }
  /* The assumption label hangs off the node's top-right corner instead of
     taking inline width — otherwise it widens the proposition box and shoves
     the centered formula leftward under its inference line. Needs an elevated
     z-index so it doesn't get covered by the right-struts of the proof tree */
  .pz-node > sup {
    left: 100%;
    position: absolute;
    top: -0.55em;
    z-index: 1;
  }
  /* Each root tree with its Select chip beneath, feet aligned on one baseline. */
  .pz-root {
    align-items: center;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  /* The premise dot: hollow until ticked, then filled with its order. The
     words live in the accessible name — visually it stays a quiet dot. */
  .pz-pick {
    align-items: center;
    background: transparent;
    border: 1.5px solid var(--rule, #d8d0c3);
    border-radius: 50%;
    color: var(--on-accent, #ffffff);
    cursor: pointer;
    display: flex;
    font: inherit;
    font-size: 0.62rem;
    font-weight: 700;
    height: 1.05rem;
    justify-content: center;
    line-height: 1;
    padding: 0;
    position: relative;
    width: 1.05rem;
  }
  /* An invisible halo brings the tap target up to ~28px — the dot is sized
     for the eye, not the finger, and touch is exactly where it matters. */
  .pz-pick::after { content: ""; inset: -0.35rem; position: absolute; }
  .pz-pick:hover { border-color: var(--blue, #0b66d8); }
  .pz-pick[aria-pressed="true"] {
    background: var(--blue, #0b66d8);
    border-color: var(--blue, #0b66d8);
  }
`;

/**
 * What the `(?)` in the toolbar opens: how the workspace works, and every key it
 * binds. Nothing of this is on the page — the button is the whole affordance —
 * so the table has to be complete, and it is the only place a reader learns that
 * the arrows move without disturbing the ticks.
 *
 * The toolbar buttons name their own keys in their tooltips, so the rows here
 * are the ones with no button: navigation, ticking, and the four fields.
 *
 * The key glyphs are literals — `Enter` is what is printed on the key — while
 * the actions are string ids, so `tsc` rejects a row the server never sent text
 * for.
 */
const SHORTCUTS: readonly {
  readonly action: AufbauProofPrawitzStringId;
  readonly keys: readonly string[];
}[] = [
  {
    action: "Move between lines, leaving the ticks alone",
    keys: ["↑", "↓", "←", "→"],
  },
  { action: "Tick or untick the line", keys: ["Space"] },
  { action: "Edit the line's formula", keys: ["Enter"] },
  { action: "Edit the line's rule", keys: ["r"] },
  { action: "Edit the assumption's label", keys: ["l"] },
  { action: "Edit the rule's discharge marks", keys: ["d"] },
  { action: "Leave the field and go back to the line", keys: ["Esc"] },
  { action: "New assumption", keys: ["a"] },
  { action: "Apply rule below", keys: ["b"] },
  { action: "Add premise above", keys: ["p"] },
  { action: "Add assumption above", keys: ["h"] },
  { action: "Delete the line and everything above it", keys: ["Del"] },
  { action: "Undo", keys: ["Ctrl-Z"] },
  { action: "Redo", keys: ["Ctrl-Y"] },
  { action: "Open this help", keys: ["?"] },
];

const INTRO_IDS: readonly AufbauProofPrawitzStringId[] = [
  "Every proof starts from assumptions. New assumption puts one in the workspace; the goal is a single tree whose bottom line is what you were asked to prove.",
  "To apply a rule, tick the dot under each premise in the order the rule takes them, then Apply rule below. The ticked trees become the premises of one new line.",
  "To discharge an assumption, give it a label and write the same label on the rule that discharges it. Both boxes appear on a line once it is selected.",
];

/**
 * An *uncontrolled* contenteditable field (see the tree editor for the caret
 * rationale). Attribute changes (selection, error, empty state) re-render
 * freely; the text is written only when unfocused.
 */
function EditableField(props: {
  readonly ariaLabel?: string;
  readonly className: string;
  readonly error?: string | undefined;
  readonly onInput: (text: string) => void;
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

  return (
    // `contentEditable` makes an editable field of this span — the `textbox`
    // role it declares is the role a contenteditable plays anyway, and it is
    // what lets `aria-label` name the label/discharge superscript fields. An
    // <input> could not sit inline inside a ProofML proposition, render the
    // Fira Code ligatures, or keep the uncontrolled-caret behaviour. The
    // onFocus select is for programmatic entry (Enter / r): editing a field
    // makes its line the current one. A click already selected through the
    // treeitem's pointerdown; ctrl-click never reaches focus at all (that
    // handler preventDefaults it), so the toggle stands alone.
    // biome-ignore lint/a11y/useSemanticElements: see above.
    <span
      ref={ref}
      aria-label={props.ariaLabel}
      class={classes}
      // Plain text only: copying a node puts its full markup on the clipboard,
      // and a rich paste would nest node spans inside the field — the model
      // reads textContent so it would never notice, but the stray elements
      // break the selection ring.
      contentEditable="plaintext-only"
      onFocus={props.onSelect}
      onInput={(event) =>
        props.onInput(event.currentTarget.textContent ?? "")
      }
      role="textbox"
      spellcheck={false}
      // Kept out of the tab order: the enclosing treeitem carries the roving
      // focus; a field is entered by click or by a shortcut on its node.
      tabIndex={-1}
      title={props.error}
    />
  );
}

function NodeView(props: {
  readonly dispatch: (action: Action) => void;
  /** The node holding the roving tabindex — follows focus, not selection. */
  readonly focusId: string | undefined;
  readonly node: PNode;
  readonly nodeErrors: Readonly<Record<string, string>>;
  readonly onFocusItem: (id: string) => void;
  readonly onNodeKeyDown: (event: KeyboardEvent, id: string) => void;
  readonly onSelect: (id: string, additive: boolean) => void;
  readonly registerNode: (id: string, el: HTMLElement | null) => void;
  readonly selected: readonly string[];
  readonly t: Translate;
}): preact.JSX.Element {
  const { dispatch, focusId, node, nodeErrors, t } = props;
  const { onFocusItem, onNodeKeyDown, onSelect, registerNode, selected } =
    props;
  const isSelected = selected.includes(node.id);
  const select = (): void => onSelect(node.id, false);
  const bracketed = node.isAssumption && node.label.trim().length > 0;

  const treeClasses = [
    node.isAssumption ? "pz-assumption" : "",
    isSelected ? "pz-current" : "",
  ]
    .filter((cls) => cls.length > 0)
    .join(" ");

  return (
    // The ProofML elements are visual layout; role="presentation" on them (and
    // on proof-proposition below) keeps the ownership chain from the outer
    // role="tree" down to the treeitem spans transparent — axe does not treat
    // unknown custom elements as generic, so without it the tree appears to
    // own no treeitems at all (aria-required-children).
    <proof-tree
      class={treeClasses.length > 0 ? treeClasses : undefined}
      role="presentation"
    >
      {/* Every derived proposition keeps its forest, empty or not: ProofML
          draws the inference line off the forest's presence and restyles it on
          the forest's own child-change event (the tree editor's bar gotcha).
          An assumption leaf stays forest-less — no line above an assumption
          (the .pz-assumption rule suppresses ProofML's uninhabited-forest bar). */}
      {node.isAssumption ? null : (
        <proof-forest role="presentation">
          {node.premises.map((child) => (
            <NodeView
              key={child.id}
              dispatch={dispatch}
              focusId={focusId}
              node={child}
              nodeErrors={nodeErrors}
              onFocusItem={onFocusItem}
              onNodeKeyDown={onNodeKeyDown}
              onSelect={onSelect}
              registerNode={registerNode}
              selected={selected}
              t={t}
            />
          ))}
        </proof-forest>
      )}
      <proof-proposition role="presentation">
        <span
          aria-selected={isSelected}
          class="pz-node"
          // Focus alone never changes the ticks — it only adopts the roving
          // tabindex. Arrow navigation and Tab-ing back into the workspace
          // move focus, and collapsing the selection on either would make a
          // keyboard multi-premise join impossible (Space could untick but
          // never accumulate). Selection changes by click, Space, the dots,
          // and the single-line shortcuts.
          onFocus={() => onFocusItem(node.id)}
          onKeyDown={(event) => {
            // Only navigate when the treeitem itself has focus; a key inside
            // an editable field must type, not move.
            if (event.target === event.currentTarget) {
              onNodeKeyDown(event, node.id);
            }
          }}
          onPointerDown={(event) => {
            // Ctrl/Cmd-click toggles the node in the ordered multi-selection;
            // preventDefault keeps the click from also focusing a field. A
            // plain click selects. Either way this one handler sees the whole
            // subtree of fields via bubbling.
            if (event.ctrlKey || event.metaKey) {
              event.preventDefault();
              onSelect(node.id, true);
            } else {
              onSelect(node.id, false);
            }
          }}
          ref={(el) => registerNode(node.id, el)}
          role="treeitem"
          tabIndex={focusId === node.id ? 0 : -1}
        >
          {bracketed ? <span class="pz-bracket">[</span> : null}
          <EditableField
            ariaLabel={t("Formula")}
            className="pz-edit"
            error={nodeErrors[node.id]}
            onInput={(text) =>
              dispatch({ id: node.id, text, type: "setFormula" })
            }
            onSelect={() => select()}
            selected={isSelected}
            value={node.formula}
          />
          {bracketed ? <span class="pz-bracket">]</span> : null}
          {node.isAssumption ? (
            <sup>
              <EditableField
                ariaLabel={t("Discharge label")}
                className="pz-edit pz-label pz-secondary"
                onInput={(text) =>
                  dispatch({ id: node.id, text, type: "setLabel" })
                }
                onSelect={() => select()}
                selected={false}
                value={node.label}
              />
            </sup>
          ) : null}
        </span>
      </proof-proposition>
      {node.isAssumption ? null : (
        <proof-inference>
          <EditableField
            ariaLabel={t("Rule")}
            className="pz-edit pz-rule"
            onInput={(text) =>
              dispatch({ id: node.id, text, type: "setRule" })
            }
            onSelect={() => select()}
            selected={false}
            value={node.rule}
          />
          <sup>
            <EditableField
              ariaLabel={t("Discharged labels")}
              className="pz-edit pz-discharge pz-secondary"
              onInput={(text) =>
                dispatch({ id: node.id, text, type: "setDischarge" })
              }
              onSelect={() => select()}
              selected={false}
              value={node.discharge}
            />
          </sup>
        </proof-inference>
      )}
    </proof-tree>
  );
}

function Editor(props: {
  readonly canRedo: boolean;
  readonly canUndo: boolean;
  readonly dispatch: (action: Action) => void;
  readonly doc: Doc;
  /** Last focused node, or null before any focus; may no longer exist. */
  readonly focusedId: string | null;
  readonly goalFormula: string;
  readonly onFocusItem: (id: string) => void;
  readonly onNodeKeyDown: (event: KeyboardEvent, id: string) => void;
  readonly onRedo: () => void;
  readonly onSelect: (id: string, additive: boolean) => void;
  readonly onUndo: () => void;
  readonly registerNode: (id: string, el: HTMLElement | null) => void;
  readonly status: Status;
  readonly t: Translate;
}): preact.JSX.Element {
  const { canRedo, canUndo, dispatch, doc, focusedId, goalFormula, t } =
    props;
  const { onFocusItem, onNodeKeyDown, onRedo, onSelect, onUndo } = props;
  const { registerNode, status } = props;
  const single =
    doc.selected.length === 1
      ? locate(doc.trees, doc.selected[0] ?? "")
      : null;
  // Exactly one treeitem is tabbable: the last-focused node while it exists,
  // else the primary selection, else the first root — so Tab enters the tree
  // where the student left it even though focus and selection move apart.
  const focusId =
    focusedId !== null && locate(doc.trees, focusedId) !== null
      ? focusedId
      : (doc.selected[0] ?? doc.trees[0]?.id);
  const canApply = selectionIsRoots(doc);
  const canGrow = single !== null && !single.node.isAssumption;
  const canDelete = single !== null;

  return (
    <>
      <p class="pz-goal">
        {t("Prove")} <code>{goalFormula}</code>
      </p>
      <div class="pz-toolbar">
        <button
          onClick={() => dispatch({ type: "addAssumption" })}
          title={t("New assumption (a)")}
          type="button"
        >
          {t("New assumption")}
        </button>
        <button
          disabled={!canApply}
          onClick={() => dispatch({ type: "applyBelow" })}
          title={t("Apply rule below (b)")}
          type="button"
        >
          {t("Apply rule below")}
        </button>
        <button
          disabled={!canGrow}
          onClick={() => dispatch({ assumption: false, type: "addAbove" })}
          title={t("Add premise above (p)")}
          type="button"
        >
          {t("Add premise above")}
        </button>
        <button
          disabled={!canGrow}
          onClick={() => dispatch({ assumption: true, type: "addAbove" })}
          title={t("Add assumption above (h)")}
          type="button"
        >
          {t("Add assumption above")}
        </button>
        <button
          disabled={!canDelete}
          onClick={() => dispatch({ type: "delete" })}
          title={t("Delete (Del)")}
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
      {/* The tree semantics only apply while there is something in the tree:
          a role="tree" with no treeitems violates aria-required-children, and
          before the first New assumption the canvas is just empty space.
          Known, accepted axe finding while a tree exists: the rule and
          discharge textboxes sit beside the treeitems (in proof-inference,
          for the ProofML layout), so the tree "owns" textboxes, which the
          aria-required-children rule rejects; the entry is baselined in
          baseline.browser.json. The id is shadow-scoped and exists to keep
          that baseline fingerprint stable across locales. */}
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-label is only
          set while role="tree" is — both hang on the same condition, which the
          static check can't see. */}
      <div
        aria-label={
          doc.trees.length > 0 ? t("Prawitz proof workspace") : undefined
        }
        aria-multiselectable={doc.trees.length > 0 ? true : undefined}
        class="prawitz-canvas"
        id="pz-workspace"
        role={doc.trees.length > 0 ? "tree" : undefined}
      >
        {doc.trees.map((tree) => {
          const picked = doc.selected.indexOf(tree.id);
          return (
            // role="group": an allowed child of the tree that, unlike the
            // tree itself, may own anything — which is what makes the rule
            // and discharge textboxes (they sit in proof-inference, outside
            // any treeitem) and the premise dot legitimate here. The
            // treeitems' required tree ancestry still resolves through it.
            // biome-ignore lint/a11y/useSemanticElements: not a form grouping (no fieldset) — a tree-structure group inside role="tree".
            <div key={tree.id} class="pz-root" role="group">
              <NodeView
                dispatch={dispatch}
                focusId={focusId}
                node={tree}
                nodeErrors={status.nodeErrors}
                onFocusItem={onFocusItem}
                onNodeKeyDown={onNodeKeyDown}
                onSelect={onSelect}
                registerNode={registerNode}
                selected={doc.selected}
                t={t}
              />
              {/* The premise dot is what makes joining trees discoverable —
                  and tappable on touch devices, where Ctrl-click doesn't
                  exist: tick each premise in order, then Apply rule below.
                  Only shown once there is more than one tree; with a single
                  tree there is nothing to join, and the dot would be noise. */}
              {doc.trees.length > 1 ? (
                <button
                  aria-label={
                    picked >= 0
                      ? t("Premise {order}", { order: picked + 1 })
                      : t("Select")
                  }
                  aria-pressed={picked >= 0}
                  class="pz-pick"
                  onClick={() => onSelect(tree.id, true)}
                  title={
                    picked >= 0
                      ? t("Premise {order}", { order: picked + 1 })
                      : t("Select")
                  }
                  type="button"
                >
                  {picked >= 0 ? picked + 1 : ""}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// The custom element: owns the document, runs the compile side-effect, and
// mounts the Preact island into the server-rendered shadow root.
// ---------------------------------------------------------------------------

class AufbauProofPrawitz extends CarnapExerciseElement<AufbauProofPrawitzStringId> {
  private mm0 = "";
  private goalName = "";
  private goalFormula = "";
  private assumptionRule = "ax";
  /** The theory's turnstile; artifacts compiled before `sequent=` existed have
   *  no `sequentSymbol`, so this default stands in for them. */
  private sequentSymbol = "⊢";
  private doc: Doc = { selected: [], trees: [] };
  private status: Status = { mark: "idle", markTitle: "", nodeErrors: {} };
  private readonly localize: Translate = (id, values) => this.t(id, values);
  private past: Doc[] = [];
  private future: Doc[] = [];
  private coalesceKey: string | null = null;
  private nodeRefs = new Map<string, HTMLElement>();
  /** Roving-tabindex position: the last node to hold real DOM focus. */
  private focusedId: string | null = null;
  private listeners = new AbortController();
  private mount: HTMLElement | null = null;
  /** Built once in {@link enhance}; see {@link showHelp} for where it lives. */
  private helpDialog: HTMLDialogElement | null = null;
  private proofText = "";
  private lineSpans: readonly { from: number; nodeId: string; to: number }[] =
    [];
  private structural: readonly PrawitzDiagnostic[] = [];
  private mmb = "";
  private compileToken = 0;
  private debounceHandle: ReturnType<typeof setTimeout> | null = null;

  protected enhance(): void {
    const root = this.shadowRoot;
    const data = this.publicData;

    if (
      root === null ||
      this.mode !== "answer" ||
      !isPrawitzPublicData(data)
    ) {
      return;
    }

    this.mm0 = data.mm0;
    this.goalName = data.goalName;
    this.goalFormula = data.goalFormula;
    this.assumptionRule = data.assumptionRule;
    if (typeof data.sequentSymbol === "string" && data.sequentSymbol !== "") {
      this.sequentSymbol = data.sequentSymbol;
    }

    const container = root.querySelector<HTMLElement>(".proof-prawitz");
    if (container === null) {
      return;
    }

    const style = document.createElement("style");
    style.textContent = SHADOW_STYLES;
    root.appendChild(style);

    // A restored submission wins; then an authored starter; otherwise the
    // workspace opens empty — the student builds top-down from assumptions, so
    // unlike the goal-rooted tree editor there is no seeded root. The goal
    // shows as the fixed target row.
    const prior = this.priorAnswer as { tree?: unknown } | null;
    if (prior !== null && isPrawitzProofNode(prior.tree)) {
      const model = deserialize(prior.tree, this.assumptionRule);
      this.doc = { selected: [model.id], trees: [model] };
    } else if (data.starterTree !== undefined) {
      const model = deserialize(data.starterTree, this.assumptionRule);
      this.doc = { selected: [model.id], trees: [model] };
    }

    container.removeAttribute("aria-busy");
    root.querySelector(".prawitz-canvas")?.remove();
    const actionsSlot = container.querySelector(
      'slot[name="exercise-actions"]',
    );
    this.mount = document.createElement("div");
    container.insertBefore(this.mount, actionsSlot);
    this.rerender();

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
      title: this.t("Using the Prawitz proof editor"),
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
      // formula/label fields sit inside the treeitem; the rule/discharge
      // fields are siblings, so fall back to the owning proof-tree's treeitem.
      const target = event.target as HTMLElement | null;
      if (target?.classList.contains("pz-edit") === true) {
        event.preventDefault();
        const node =
          target.closest<HTMLElement>(".pz-node") ??
          target
            .closest("proof-tree")
            ?.querySelector<HTMLElement>(
              ":scope > proof-proposition .pz-node",
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
    // The graded tree is the workspace's single derivation; while the forest
    // is still split, mirror the leftmost tree so a draft submission carries
    // *something* restorable (mmb stays empty, so it cannot grade correct).
    const first = this.doc.trees[0] ?? EMPTY_TREE;
    return {
      mmb: this.mmb,
      proofText: this.proofText,
      tree: serialize(first, this.assumptionRule),
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

    if (next.trees !== previous.trees) {
      const key = coalesceKeyFor(action);
      if (key === null || key !== this.coalesceKey) {
        this.pushHistory(previous);
      }
      this.coalesceKey = key;
      this.future = [];
    } else {
      this.coalesceKey = null;
    }

    this.doc = next;
    this.rerender();
    if (next.trees !== previous.trees) {
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

  private readonly selectNode = (id: string, additive: boolean): void => {
    // A plain (non-additive) select is the "work here" gesture, so it also
    // adopts the roving tabindex; an additive tick (Space, Ctrl-click, the
    // premise dots) leaves focus wherever the student has it.
    if (!additive) {
      this.focusedId = id;
    }
    this.dispatch({ additive, id, type: "select" });
    this.rerender();
  };

  /** A treeitem took DOM focus: track it for the roving tabindex only. */
  private readonly focusItem = (id: string): void => {
    if (this.focusedId !== id) {
      this.focusedId = id;
      this.rerender();
    }
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

  /** Move DOM focus to `id` without touching the selection. */
  private focusNode(id: string): void {
    this.nodeRefs.get(id)?.focus();
  }

  private focusField(nodeId: string, selector: string): void {
    // Formula/label live inside the treeitem; rule/discharge live in the
    // sibling <proof-inference>, reached via the owning <proof-tree>.
    const item = this.nodeRefs.get(nodeId);
    const field =
      item?.querySelector<HTMLElement>(selector) ??
      item
        ?.closest("proof-tree")
        ?.querySelector<HTMLElement>(`:scope > proof-inference ${selector}`);
    field?.focus();
  }

  /**
   * Keyboard model: a node's treeitem holds the roving focus, and moving that
   * focus never changes the ticked selection — that is what lets Space
   * accumulate a multi-selection across roots for Apply rule below. Arrows
   * move within a tree (premises render *above* their parent, so Up steps
   * into the first premise and Down to the parent; Left/Right walk siblings,
   * or neighbouring roots at the top level). Enter edits the formula, r the
   * rule, l the label, d the discharge marks; a / b / p / h mirror the
   * toolbar; Delete removes the node (promoting its premises). The
   * single-line gestures (p / h / l / d / Delete) first select the focused
   * line — they act *here*, and for l / d the selection is also what reveals
   * an empty label or discharge box so it can take focus. While editing a
   * field only Escape is intercepted; everything else types normally.
   */
  private onTreeKeyDown(event: KeyboardEvent, nodeId: string): void {
    const located = locate(this.doc.trees, nodeId);
    if (located === null) {
      return;
    }
    const { node, parentId, rootIndex } = located;
    const parent =
      parentId === null ? null : locate(this.doc.trees, parentId);

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
        const siblings =
          parent === null ? this.doc.trees : parent.node.premises;
        const index =
          parent === null
            ? rootIndex
            : siblings.findIndex((child) => child.id === nodeId);
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
      case " ": {
        event.preventDefault();
        this.dispatch({ additive: true, id: nodeId, type: "select" });
        break;
      }
      case "Enter":
        event.preventDefault();
        this.nodeRefs
          .get(nodeId)
          ?.querySelector<HTMLElement>(".pz-edit")
          ?.focus();
        break;
      case "r":
      case "R":
        if (!node.isAssumption) {
          event.preventDefault();
          this.focusField(nodeId, ".pz-rule");
        }
        break;
      case "l":
      case "L":
        if (node.isAssumption) {
          event.preventDefault();
          // Select first: an empty label box is hidden on unselected lines,
          // and selecting rerenders synchronously, so it is visible (and
          // focusable) by the next line.
          this.selectNode(nodeId, false);
          this.focusField(nodeId, ".pz-label");
        }
        break;
      case "d":
      case "D":
        if (!node.isAssumption) {
          event.preventDefault();
          this.selectNode(nodeId, false);
          this.focusField(nodeId, ".pz-discharge");
        }
        break;
      case "a":
      case "A":
        event.preventDefault();
        this.dispatch({ type: "addAssumption" });
        this.focusNode(this.doc.selected[0] ?? nodeId);
        break;
      case "b":
      case "B":
        event.preventDefault();
        this.dispatch({ type: "applyBelow" });
        this.focusNode(this.doc.selected[0] ?? nodeId);
        break;
      case "p":
      case "P":
        if (!node.isAssumption) {
          event.preventDefault();
          // These grow/delete act on the selection; aim them at the focused
          // line so the keys keep meaning "here", as they did when focus and
          // selection were one.
          this.selectNode(nodeId, false);
          this.dispatch({ assumption: false, type: "addAbove" });
        }
        break;
      case "h":
      case "H":
        if (!node.isAssumption) {
          event.preventDefault();
          this.selectNode(nodeId, false);
          this.dispatch({ assumption: true, type: "addAbove" });
        }
        break;
      case "Delete":
      case "Backspace": {
        event.preventDefault();
        this.selectNode(nodeId, false);
        this.dispatch({ type: "delete" });
        const next = this.doc.selected[0];
        if (next !== undefined) {
          this.focusNode(next);
        }
        break;
      }
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
        focusedId={this.focusedId}
        goalFormula={this.goalFormula}
        onFocusItem={this.focusItem}
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
    // Translation (and hence compiling) needs a single derivation; while the
    // forest is split, the answer's proofText stays empty and the mark idle.
    const single =
      this.doc.trees.length === 1 ? this.doc.trees[0] : undefined;
    if (single === undefined) {
      this.proofText = "";
      this.lineSpans = [];
      this.structural = [];
      this.mmb = "";
      if (this.debounceHandle !== null) {
        clearTimeout(this.debounceHandle);
      }
      this.compileToken += 1;
      this.setStatus({ mark: "idle", markTitle: "", nodeErrors: {} });
      this.syncAnswer();
      return;
    }

    const translated = prawitzToAuf(
      serialize(single, this.assumptionRule),
      this.goalName,
      this.assumptionRule,
      this.sequentSymbol,
    );
    this.proofText = translated.proofText;
    this.lineSpans = translated.lineSpans;
    this.structural = translated.diagnostics;
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

  private structuralMessage(diagnostic: PrawitzDiagnostic): string {
    switch (diagnostic.code) {
      case "discharge_without_leaf":
        return this.t(
          "This discharge mark doesn't match any assumption above it.",
        );
      case "discharge_formula_mismatch":
        return this.t(
          "The assumptions discharged together here must share one formula.",
        );
      case "assumption_with_premises":
        return this.t("An assumption can't have premises.");
      default:
        return this.t("Problem here.");
    }
  }

  private async compile(): Promise<void> {
    const token = ++this.compileToken;
    const proof = this.proofText;

    let compiler: LoadedCompiler;
    try {
      compiler = await loadCompilerOnce();
    } catch {
      compilerPromise = null;
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
      this.setStatus({
        mark: "idle",
        markTitle: "",
        nodeErrors: this.structuralErrors(),
      });
      this.syncAnswer();
      return;
    }

    if (token !== this.compileToken) {
      return;
    }

    const nodeErrors = {
      ...this.collectNodeErrors(result, proof),
      ...this.structuralErrors(),
    };
    if (
      result.ok === true &&
      result.mmbBytes !== undefined &&
      this.structural.length === 0
    ) {
      this.mmb = bytesToBase64(result.mmbBytes);
      this.setStatus({ mark: "ok", markTitle: "", nodeErrors });
    } else {
      this.mmb = "";
      this.setStatus({ mark: "idle", markTitle: "", nodeErrors });
    }
    this.syncAnswer();
  }

  /** The translator's structural diagnostics as a node-id → message map. */
  private structuralErrors(): Record<string, string> {
    const errors: Record<string, string> = {};
    for (const item of this.structural) {
      const message = this.structuralMessage(item);
      errors[item.nodeId] =
        errors[item.nodeId] === undefined
          ? message
          : `${errors[item.nodeId]}\n${message}`;
    }
    return errors;
  }

  /**
   * Attribute each compiler diagnostic (a UTF-8 byte span into the translated
   * proof) to the tree node whose generated line contains it, via the
   * translator's line map.
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

    const fallbackId = this.doc.trees[0]?.id ?? "";
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
      const nodeId = span?.nodeId ?? fallbackId;
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

// One compiler instance per page load, shared across every proof element and
// lazily instantiated so the ~4.5 MB wasm loads only when a proof is edited.
let compilerPromise: Promise<LoadedCompiler> | null = null;

function loadCompilerOnce(): Promise<LoadedCompiler> {
  if (compilerPromise === null) {
    compilerPromise = import("@aufbau/compiler").then((module) =>
      module.loadCompiler({ wasmUrl: COMPILER_WASM_URL }),
    );
  }
  return compilerPromise;
}

register("carnap-aufbau-proof-prawitz", AufbauProofPrawitz);
