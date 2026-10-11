/** @jsxImportSource preact */
/**
 * `<carnap-truth-tree>` — the truth-tree editor.
 *
 * The server renders the root into a Declarative Shadow Root, inert and drawn
 * with no JS (see the worker-side `renderTruthTreeElement`). On connect this
 * element replaces that body with a Preact island: the tableau view over the
 * tree and its toolbar. The tree is the whole answer; what it shows follows
 * from it, so the student is not asked to say.
 *
 * Every action is one key (or one toolbar button, whose keys the `(?)`
 * dialog lists) on the row at the cursor,
 * and works on that row's branch. In `develop="type"` the student writes each
 * step: Stack or Split, then the rows' sentences, then the row they develop in
 * the margin. In `develop="fill"` Develop writes the rule's rows under every
 * open branch below the row, asking only for an instance's name (and, on an
 * identity, the row to rewrite with it). Closing a branch cites its two rows,
 * or its one row `a≠a`; ↑ marks one open and complete.
 *
 * The mouse follows the proof tree's conventions: a click on a row types in
 * it, a click in its margin types its citation, and a click elsewhere ends
 * the typing, so the arrow keys move between rows again. The ring shows
 * when they do.
 *
 * The tree is checked on every edit by the same `checkTree` the grader runs,
 * so full feedback can flag a wrong row as it is written. Marks and margin
 * notes are computed, never typed. As with the model, there is no answer key:
 * the Check is `judgeTree` over public data.
 */

import { render } from "preact";
import type { TableauDocument } from "../../tableau/document";
import { TableauIndex } from "../../tableau/document";
import {
  insertRowAfter,
  remint,
  removeChildren,
  removeRow,
  setEnd,
  setRowCites,
  setRowText,
  splitNode,
  stackRows,
} from "../../tableau/edit";
import type { TableauAnnotations } from "../../tableau/html";
import type { TableauLayout } from "../../tableau/layout";
import { layoutTableau, rowAtLine } from "../../tableau/layout";
import type { TableauKeyAction } from "../../tableau/navigate";
import { keyAction, moveCursor } from "../../tableau/navigate";
import type { Formula } from "../../worker/exercise-kit/formula";
import {
  languageNames,
  namesIn,
  parseTerm,
  replaceName,
  sameFormula,
  substitute,
} from "../../worker/exercise-kit/formula";
import { treeAnnotations } from "../../worker/exercises/truth-tree/annotations";
import type { ResolvedTree } from "../../worker/exercises/truth-tree/grading";
import {
  isTruthTreeAnswerData,
  isTruthTreePublicData,
  judgeTree,
  resolveTruthTree,
  startingTree,
  startsFromRoot,
} from "../../worker/exercises/truth-tree/grading";
import type { TreeReport } from "../../worker/exercises/truth-tree/logic/check";
import {
  checkTree,
  closesAlone,
  nameIdentity,
} from "../../worker/exercises/truth-tree/logic/check";
import { displayFormula } from "../../worker/exercises/truth-tree/logic/formulas";
import { displayName } from "../../worker/exercises/truth-tree/logic/labels";
import type { Rule } from "../../worker/exercises/truth-tree/logic/rules";
import { ruleFor } from "../../worker/exercises/truth-tree/logic/rules";
import type { TruthTreeStringId } from "../../worker/exercises/truth-tree/strings";
import type {
  TruthTreeAnswerData,
  TruthTreePublicData,
} from "../../worker/exercises/truth-tree/types";
import type { TreeWords } from "../../worker/exercises/truth-tree/verdict-text";
import {
  describeEndProblem,
  describeJudgement,
  describeRowProblem,
} from "../../worker/exercises/truth-tree/verdict-text";
import { TableauView } from "../tableau/view";
import { CarnapExerciseElement, register } from "./base";
import islandStyles from "./carnap-truth-tree-v1.css" with { type: "text" };
import {
  createHelpDialog,
  HELP_DIALOG_STYLES,
  mountHelpTrigger,
  openHelpDialog,
} from "./help-dialog";
import { mountProblemPopup } from "./problem-popup";
import { ToolbarIcon } from "./toolbar-icon";
import { TOOLBAR_STYLES, type ToolbarIconName } from "./toolbar-icons";

const HISTORY_LIMIT = 200;

/**
 * What a tree as it stands gives: its index, its layout and its check. A
 * document is never changed in place, so these are kept until the element's
 * tree is replaced, not rebuilt at every render, keystroke and row asked
 * about.
 */
interface Derived {
  readonly tree: TableauDocument;
  readonly index: TableauIndex;
  readonly layout: TableauLayout;
  report?: TreeReport | null;
}

/** A question the editor is asking below the tree, and the answer so far. */
type Prompt =
  /** Fill mode: the name for a quantifier row's instance. */
  | {
      readonly type: "name";
      readonly row: string;
      readonly targets: readonly string[];
      readonly draft: string;
    }
  /** Fill mode: the number of the row an identity row rewrites. */
  | {
      readonly type: "substitute";
      readonly row: string;
      readonly draft: string;
    }
  /** Fill mode: which of an identity's names to replace, when both occur. */
  | {
      readonly type: "direction";
      readonly row: string;
      readonly line: number;
      readonly names: readonly [string, string];
    };

/**
 * Closing a branch: the rows marked so far as the sentence and its negation
 * it closes on, as the truth table's counterexample row is marked. Two
 * marked close it, or one that closes a branch alone (`a≠a`).
 */
interface Closing {
  readonly leaf: string;
  readonly picked: readonly string[];
}

/**
 * A citation typed that does not resolve to rows: `3,` or a row not above.
 * The step stays uncited, and the margin keeps the text, squiggled, until it
 * is put right. Editor state, not answer: a reload keeps the tree only.
 */
interface CiteDraft {
  readonly text: string;
  readonly problem: string;
}

interface Snapshot {
  readonly tree: TableauDocument;
  readonly cursor: string | null;
  /** The steps' unresolved citations, by development. */
  readonly drafts: ReadonlyMap<string, CiteDraft>;
}

interface Shortcut {
  readonly action: TruthTreeStringId;
  readonly icon?: ToolbarIconName;
  readonly keys: readonly string[];
}

const TYPE_SHORTCUTS: readonly Shortcut[] = [
  { action: "Move between rows", keys: ["←", "→", "↑", "↓"] },
  { action: "Write the row's sentence", keys: ["Enter"] },
  {
    action:
      "Type the row it develops; Alt-C also works while writing the row",
    keys: ["c", "Alt-C"],
  },
  {
    action: "From the end of a line, go on to its citation; Delete clears it",
    keys: ["→"],
  },
  {
    action: "Add a row at the end of the branch",
    icon: "tree-stack",
    keys: ["t"],
  },
  { action: "Split the branch in two", icon: "tree-split", keys: ["s"] },
  { action: "Add a row to this step", icon: "tree-add-row", keys: ["r"] },
  { action: "Close the branch", icon: "tree-close", keys: ["x"] },
  {
    action: "Mark a row the branch closes on, once closing",
    keys: ["Space", "Enter"],
  },
  {
    action: "Mark the branch open and complete",
    icon: "tree-open",
    keys: ["o"],
  },
  {
    action:
      "Delete the row or take back its split; on an end mark, reopen the branch",
    icon: "tree-delete",
    keys: ["Delete"],
  },
  { action: "Undo or redo", icon: "undo", keys: ["Ctrl-Z", "Ctrl-Y"] },
];

const FILL_SHORTCUTS: readonly Shortcut[] = [
  { action: "Move between rows", keys: ["←", "→", "↑", "↓"] },
  {
    action: "Develop the row on every open branch below it",
    icon: "tree-develop",
    keys: ["d"],
  },
  ...TYPE_SHORTCUTS.slice(7),
];

/** Of some rows, the one furthest right in the layout. */
function rightmost(
  rows: readonly string[],
  layout: TableauLayout,
): string | null {
  let best: { id: string; start: number } | null = null;

  for (const id of rows) {
    const start = layout.rows.get(id)?.span.start;

    if (start !== undefined && (best === null || start > best.start)) {
      best = { id, start };
    }
  }

  return best?.id ?? null;
}

/** Row numbers typed as text: `4, 5`, `4 5`. `null` if any is not a number. */
function parseNumbers(text: string): number[] | null {
  const pieces = text.split(/[\s,]+/).filter((piece) => piece.length > 0);
  const numbers = pieces.map((piece) => Number(piece));

  return numbers.every((number) => Number.isInteger(number) && number > 0)
    ? numbers
    : null;
}

class CarnapTruthTree extends CarnapExerciseElement<TruthTreeStringId> {
  private data: TruthTreePublicData | null = null;
  private resolved: ResolvedTree | null = null;
  private mount: HTMLElement | null = null;
  private helpDialog: HTMLDialogElement | null = null;

  private tree: TableauDocument = { nodes: [] };
  private derived: Derived | null = null;
  private drafts: ReadonlyMap<string, CiteDraft> = new Map();
  private past: Snapshot[] = [];
  private future: Snapshot[] = [];
  private cursor: string | null = null;
  private editing: string | null = null;
  /**
   * An edit begun on an existing row, whose undo step is recorded at its
   * first keystroke, so that opening a row and leaving it records nothing.
   */
  private editPending = false;
  private citing: { row: string; draft: string } | null = null;
  /**
   * The row whose citation the selection is on, in its line's margin, while
   * the cursor is that row: the arrows reach a line's citation as they reach
   * its rows. Any move of the cursor elsewhere leaves it.
   */
  private marginOf: string | null = null;
  private closing: Closing | null = null;
  private prompt: Prompt | null = null;
  private announcement = "";
  /** A pointer is down, so a blur is a click elsewhere; see `strayBlur`. */
  private pointing = false;
  private readonly listeners = new AbortController();
  private focusTree = false;
  private seq = 0;

  private readonly mint = (): string => {
    this.seq += 1;
    return `e${this.seq}`;
  };

  private readonly words: TreeWords = (id, values) =>
    this.t(id as TruthTreeStringId, values);

  protected enhance(): void {
    const root = this.shadowRoot;
    const data = this.publicData;

    if (
      root === null ||
      this.mode !== "answer" ||
      !isTruthTreePublicData(data)
    ) {
      return;
    }

    const resolved = resolveTruthTree(data);

    if (resolved === null) {
      return;
    }

    this.data = data;
    this.resolved = resolved;
    this.restore(resolved);

    const body = root.querySelector<HTMLElement>("[data-role='body']");

    if (body === null) {
      return;
    }

    const style = document.createElement("style");
    style.textContent = `${TOOLBAR_STYLES}\n${islandStyles}\n${HELP_DIALOG_STYLES}`;
    root.appendChild(style);

    body.replaceChildren();
    this.mount = body;
    mountProblemPopup(root, body, this.listeners.signal);
    this.rerender();

    const fill = data.develop === "fill";

    this.helpDialog = createHelpDialog({
      close: this.t("Close help"),
      intro: [
        this.t(
          "Move to a row with the arrow keys or by clicking it; each action works on the row or branch there.",
        ),
        fill
          ? this.t(
              "Choose a row to develop, and the rows its rule writes are added under every open branch below it.",
            )
          : this.t(
              "Write each step's rows, choosing whether they stack on the branch or split it, and type the row they develop in the margin.",
            ),
        this.t(
          "Close a branch on a sentence and its negation, citing both rows, and mark a complete open branch ↑. The tree is done when every branch is closed, or one is marked open.",
        ),
      ],
      keyboard: this.t("Keyboard"),
      shortcuts: (fill ? FILL_SHORTCUTS : TYPE_SHORTCUTS).map((shortcut) => ({
        action: this.t(shortcut.action),
        keys: shortcut.keys,
        ...(shortcut.icon === undefined ? {} : { icon: shortcut.icon }),
      })),
      title: this.t("Using the tree editor"),
    });
    root.appendChild(this.helpDialog);

    mountHelpTrigger(
      this,
      this.t("Usage and keyboard shortcuts"),
      (trigger) => {
        if (this.helpDialog !== null) {
          openHelpDialog(this.helpDialog, trigger);
        }
      },
    );

    this.buildCheck();

    // A click's blur is the reader moving elsewhere; see `strayBlur`. The
    // flag holds from the press to the click, whose focus change comes
    // between them for a mouse and a touch alike, and any key clears it.
    const signal = this.listeners.signal;
    const pointing = (value: boolean) => () => {
      this.pointing = value;
    };
    document.addEventListener("pointerdown", pointing(true), {
      capture: true,
      signal,
    });
    for (const type of ["click", "keydown"]) {
      document.addEventListener(type, pointing(false), {
        capture: true,
        signal,
      });
    }

    root.querySelector("fieldset")?.removeAttribute("aria-busy");
    this.dataset.enhanced = "true";
  }

  disconnectedCallback(): void {
    this.listeners.abort();
    if (this.mount !== null) {
      render(null, this.mount);
    }
  }

  /**
   * The prior answer, with fresh ids, or the root alone: also when the prior
   * starts from a root the exercise no longer gives.
   */
  private restore(resolved: ResolvedTree): void {
    const prior = this.priorAnswer;
    const saved =
      isTruthTreeAnswerData(prior) && startsFromRoot(prior, resolved)
        ? { nodes: prior.nodes }
        : startingTree(resolved);

    this.tree = remint(saved, this.mint);
    this.cursor = this.lastRow();
  }

  /** The last row of the tree in tree order: a sensible place to start. */
  private lastRow(): string | null {
    const order = this.index.preorder();
    const rows = order.flatMap((node) => node.rows);
    return rows[rows.length - 1]?.id ?? null;
  }

  /** Its Check grades the work in the browser. */
  protected override get gradesLocally(): boolean {
    return true;
  }

  protected getAnswer(): TruthTreeAnswerData {
    return { nodes: this.tree.nodes };
  }

  // --- The check ---------------------------------------------------------

  private derive(): Derived {
    if (this.derived?.tree !== this.tree) {
      this.derived = {
        index: new TableauIndex(this.tree),
        layout: layoutTableau(this.tree),
        tree: this.tree,
      };
    }

    return this.derived;
  }

  private get index(): TableauIndex {
    return this.derive().index;
  }

  private get layout(): TableauLayout {
    return this.derive().layout;
  }

  private report(): TreeReport | null {
    const resolved = this.resolved;
    const derived = this.derive();

    derived.report ??=
      resolved === null
        ? null
        : checkTree({
            reader: resolved.reader,
            root: resolved.root,
            system: resolved.system,
            tree: this.tree,
          });

    return derived.report;
  }

  private buildCheck(): void {
    if (this.feedback === "none") {
      return;
    }

    const bar = this.querySelector<HTMLElement>(".exercise-actions");

    if (bar === null) {
      return;
    }

    const check = document.createElement("button");
    check.type = "button";
    check.className = "truth-tree-check";
    check.textContent = this.t("Check");
    check.addEventListener("click", () => this.runCheck());
    bar.insertBefore(
      check,
      bar.querySelector<HTMLElement>('button[type="submit"]'),
    );
  }

  private runCheck(): void {
    const resolved = this.resolved;

    if (resolved === null) {
      return;
    }

    const judgement = judgeTree(resolved, this.getAnswer());

    this.setCheckStatus(
      describeJudgement(judgement, this.tree, this.words, this.showsDetail),
      judgement.ok,
    );
    this.setMark(judgement.ok ? "ok" : "idle");
  }

  // --- Editing -------------------------------------------------------------

  private announce(text: string): void {
    // A repeated sentence would not be re-read by a live region that sees no
    // change, so an identical announcement is nudged with a trailing space.
    this.announcement = text === this.announcement.trim() ? `${text} ` : text;
  }

  private refuse(text: string): void {
    this.announce(text);
    this.rerender();
  }

  /** Record the tree as it stands, before a change. */
  private remember(): void {
    this.past.push(this.snapshot());

    if (this.past.length > HISTORY_LIMIT) {
      this.past.shift();
    }

    this.future = [];
  }

  /** Make a change: remember the old tree, take the new one, say so. */
  private commit(tree: TableauDocument, announcement: string): void {
    this.remember();
    this.tree = tree;
    this.announce(announcement);
    this.edited();
  }

  private edited(): void {
    this.setCheckStatus("");
    this.setMark("idle");
    this.syncAnswer();
    this.rerender();
  }

  private get fill(): boolean {
    return this.data?.develop === "fill";
  }

  private number(rowId: string, layout = this.layout): string {
    const line = layout.rows.get(rowId)?.line;
    return line === undefined ? "?" : String(line);
  }

  private isRootRow(rowId: string): boolean {
    const location = this.index.row(rowId);

    return (
      location !== null &&
      location.node.parent === null &&
      location.index < (this.resolved?.root.length ?? 0)
    );
  }

  /** Whether an id names a branch's end mark: its node's, with an end. */
  private isEnd(itemId: string): boolean {
    return this.index.nodes.get(itemId)?.end !== undefined;
  }

  /** The row at the cursor, or `null` when it is on an end mark. */
  private cursorRowId(): string | null {
    return this.cursor === null || this.index.row(this.cursor) === null
      ? null
      : this.cursor;
  }

  /** The leaf a branch action at the cursor works on, or a refusal. */
  private leafAtCursor(): string | null {
    const index = this.index;

    if (this.cursor !== null && this.isEnd(this.cursor)) {
      return this.cursor;
    }

    const location = this.cursor === null ? null : index.row(this.cursor);

    if (location === null) {
      return null;
    }

    if (index.children(location.node.id).length > 0) {
      this.refuse(this.t("Move to the end of a branch first."));
      return null;
    }

    return location.node.id;
  }

  private readonly act = (action: TableauKeyAction): void => {
    this.focusTree = true;

    if (this.onMarginStop() && this.marginAct(action)) {
      this.rerender();
      return;
    }

    this.marginOf = null;

    if (action === "right") {
      const head = this.marginToRight();

      if (head !== null) {
        this.cursor = head;
        this.marginOf = head;
        this.rerender();
        return;
      }
    }

    switch (action) {
      case "up":
      case "down":
      case "left":
      case "right": {
        const next =
          this.cursor === null
            ? null
            : moveCursor(this.index, this.layout, this.cursor, action);

        if (next !== null) {
          this.cursor = next;
          this.rerender();
        }

        return;
      }
      case "first":
      case "last": {
        const rows = this.index.preorder().flatMap((node) => node.rows);
        const target = action === "first" ? rows[0] : rows[rows.length - 1];

        if (target !== undefined) {
          this.cursor = target.id;
          this.rerender();
        }

        return;
      }
      default:
        this.command(action);
    }
  };

  /** Whether the selection is on a citation rather than a row. */
  private onMarginStop(): boolean {
    return (
      this.marginOf !== null &&
      this.marginOf === this.cursor &&
      this.citing === null
    );
  }

  /**
   * The row whose citation → reaches from the cursor: at the end of its line,
   * with nothing further right on it, a line whose margin takes a citation.
   */
  private marginToRight(): string | null {
    const layout = this.layout;
    const placed =
      this.cursor === null ? undefined : layout.rows.get(this.cursor);

    if (
      placed === undefined ||
      !this.citableLines(layout).has(placed.line) ||
      [...layout.rows.values(), ...layout.ends.values()].some(
        (other) =>
          other.line === placed.line && other.span.start >= placed.span.end,
      )
    ) {
      return null;
    }

    return this.marginHead(placed.line, layout);
  }

  /** The row a line's citation belongs to: its rightmost step head. */
  private marginHead(line: number, layout: TableauLayout): string | null {
    const heads = (layout.lineRows.get(line) ?? []).filter(
      (row) => layout.heads.get(row) === row && !this.isRootRow(row),
    );

    return rightmost(heads, layout);
  }

  /**
   * A key with the selection on a citation: ← goes back to the line's rows,
   * ↑ and ↓ to the citations of the lines above and below, Enter or c types
   * it, and Delete clears it (the row stays). `false` for any other action,
   * which leaves the citation for its row.
   */
  private marginAct(action: TableauKeyAction): boolean {
    const layout = this.layout;
    const line =
      this.cursor === null ? undefined : layout.rows.get(this.cursor)?.line;

    if (line === undefined || this.cursor === null) {
      return false;
    }

    switch (action) {
      case "left": {
        this.cursor =
          rightmost(layout.lineRows.get(line) ?? [], layout) ?? this.cursor;
        this.marginOf = null;
        return true;
      }
      case "right":
        return true;
      case "up":
      case "down": {
        const lines = [...this.citableLines(layout)].sort((a, b) => a - b);
        const next =
          action === "up"
            ? lines.filter((each) => each < line).pop()
            : lines.find((each) => each > line);
        const head =
          next === undefined ? null : this.marginHead(next, layout);

        if (head !== null) {
          this.cursor = head;
          this.marginOf = head;
        }

        return true;
      }
      case "edit":
      case "cite":
        this.startCiting();
        return true;
      case "delete":
        this.commitCite({ draft: "", row: this.cursor }, true);
        return true;
      default:
        return false;
    }
  }

  /** The actions that change the tree, or start to. */
  private command(action: TableauKeyAction): void {
    const fill = this.fill;

    // Any other action puts away a closing half marked, and any action at
    // all an open prompt, whose targets were the tree's before the action.
    if (this.closing !== null && action !== "close") {
      this.closing = null;
    }

    this.prompt = null;

    const commands: Partial<Record<TableauKeyAction, () => void>> = {
      "add-row": () => fill || this.addRow(),
      cite: () => this.startCiting(),
      close: () => this.closeBranch(),
      delete: () => this.deleteRow(),
      develop: () => fill && this.develop(),
      edit: () => this.startEditing(),
      open: () => this.openBranch(),
      redo: () => this.redo(),
      split: () => fill || this.split(),
      stack: () => fill || this.stack(),
      undo: () => this.undo(),
    };

    commands[action]?.();
  }

  private startEditing(): void {
    const end =
      this.cursor === null
        ? undefined
        : this.index.nodes.get(this.cursor)?.end;

    // Enter on a ×: mark its rows again, starting from the ones it cites.
    if (this.cursor !== null && end?.type === "closed") {
      this.startClosing(this.cursor, end.cites);
      return;
    }

    const row = this.cursorRowId();

    if (row === null || this.fill) {
      return;
    }

    if (this.isRootRow(row)) {
      this.refuse(
        this.t("The root's rows are given, and cannot be changed."),
      );
      return;
    }

    this.editing = row;
    this.editPending = true;
    this.citing = null;
    this.rerender();
  }

  private startCiting(): void {
    const row = this.cursorRowId();

    if (row === null || this.fill) {
      return;
    }

    if (this.isRootRow(row)) {
      this.refuse(
        this.t("The root's rows are given, and cannot be changed."),
      );
      return;
    }

    // A step is cited once, beside its first row.
    const head = this.layout.heads.get(row) ?? row;

    this.editing = null;
    this.citing = { draft: this.citationText(head), row: head };
    this.rerender();
  }

  /** A citation's name, for the selection on it. */
  private marginLabel(rowId: string, layout: TableauLayout): string {
    const row = this.number(rowId, layout);
    const cites = this.citationText(rowId, layout);

    return cites === ""
      ? this.t("Citation of row {row}, not yet written", { row })
      : this.t("Citation of row {row}: {cites}", { cites, row });
  }

  /** A row's citation as the margin shows it: its draft, or its numbers. */
  private citationText(rowId: string, layout = this.layout) {
    const row = this.index.row(rowId)?.row;

    return row === undefined
      ? ""
      : (this.drafts.get(row.dev)?.text ??
          row.cites.map((cite) => this.number(cite, layout)).join(", "));
  }

  /** A new step: one empty row at the end of the branch. */
  private stack(): void {
    const leaf = this.leafAtCursor();

    if (leaf === null) {
      return;
    }

    if (this.index.nodes.get(leaf)?.end !== undefined) {
      this.refuse(
        this.t("This branch is already ended. Reopen it to add to it."),
      );
      return;
    }

    const made = stackRows(
      this.tree,
      leaf,
      [{ cites: [], dev: this.mint(), text: "" }],
      this.mint,
    );
    const row = made.rows[0] ?? null;

    this.remember();
    this.tree = made.document;
    this.cursor = row;
    this.editing = row;
    this.editPending = false;
    this.announce(
      this.t("New row {row}.", {
        row: row === null ? "?" : this.number(row),
      }),
    );
    this.edited();
  }

  /** A new step that splits the branch: one empty row on each side. */
  private split(): void {
    const leaf = this.leafAtCursor();
    const index = this.index;

    if (leaf === null) {
      return;
    }

    if (index.nodes.get(leaf)?.end !== undefined) {
      this.refuse(
        this.t("This branch is already ended. Reopen it to add to it."),
      );
      return;
    }

    const dev = this.mint();
    const empty = { cites: [] as string[], dev, text: "" };
    const made = splitNode(this.tree, leaf, [[empty], [empty]], this.mint);
    const above = this.cursor;

    this.remember();
    this.tree = made.document;
    this.cursor = made.rows[0] ?? null;
    this.editing = this.cursor;
    this.editPending = false;
    this.announce(
      this.t("Split below row {row}: two new branches.", {
        row: above === null ? "?" : this.number(above),
      }),
    );
    this.edited();
  }

  /** Another row in the cursor's step, directly below it. */
  private addRow(): void {
    const row = this.cursor;
    const location = row === null ? null : this.index.row(row);

    if (row === null || location === null) {
      return;
    }

    if (this.isRootRow(row)) {
      this.refuse(
        this.t("The root's rows are given, and cannot be changed."),
      );
      return;
    }

    const made = insertRowAfter(
      this.tree,
      row,
      { cites: location.row.cites, dev: location.row.dev, text: "" },
      this.mint,
    );

    if (made === null) {
      return;
    }

    this.remember();
    this.tree = made.document;
    this.cursor = made.row;
    this.editing = made.row;
    this.editPending = false;
    this.announce(this.t("New row {row}.", { row: this.number(made.row) }));
    this.edited();
  }

  private closeBranch(): void {
    // x again, while marking the rows, puts the marking away: the cursor
    // may be on any row of the branch by now, not just its last node's.
    if (this.closing !== null) {
      this.cancelClosing();
      return;
    }

    const leaf = this.leafAtCursor();

    if (leaf === null) {
      return;
    }

    const end = this.index.nodes.get(leaf)?.end;

    if (end !== undefined) {
      this.reopen(leaf);
      return;
    }

    this.startClosing(leaf, []);
  }

  /** Begin marking the rows a branch closes on. */
  private startClosing(leaf: string, picked: readonly string[]): void {
    const rows = this.index.branchRows(leaf);

    // The circles are the cursor's now: it starts on a row of the branch.
    if (!rows.some((each) => each.id === this.cursor)) {
      this.cursor = rows[rows.length - 1]?.id ?? this.cursor;
    }

    this.closing = { leaf, picked };
    this.editing = null;
    this.citing = null;
    this.prompt = null;
    this.focusTree = true;
    this.announce(this.closingHint());
    this.rerender();
  }

  private closingHint(): string {
    return this.t("Mark the rows that close this branch");
  }

  private cancelClosing(): void {
    this.closing = null;
    this.focusTree = true;
    this.announce(this.t("Closing put away."));
    this.rerender();
  }

  /**
   * Mark a row the branch closes on, or unmark it, from its circle. The
   * second mark closes the branch on the two, in the order they were marked.
   */
  private pick(rowId: string): void {
    const closing = this.closing;

    if (closing === null) {
      return;
    }

    const index = this.index;
    const onBranch = index
      .branchRows(closing.leaf)
      .some((each) => each.id === rowId);
    const row = this.number(rowId);

    if (!onBranch) {
      return;
    }

    this.cursor = rowId;
    this.focusTree = true;

    if (closing.picked.includes(rowId)) {
      this.closing = {
        ...closing,
        picked: closing.picked.filter((each) => each !== rowId),
      };
      this.announce(this.t("Row {row} unmarked.", { row }));
      this.rerender();
      return;
    }

    const picked = [...closing.picked, rowId];
    const read =
      this.resolved === null
        ? null
        : this.resolved.reader.read(index.row(rowId)?.row.text ?? "");

    if (
      picked.length === 1 &&
      read?.ok === true &&
      this.resolved !== null &&
      closesAlone(read.formula, this.resolved.system)
    ) {
      this.closing = null;
      this.focusTree = true;
      this.commit(
        setEnd(this.tree, closing.leaf, { cites: picked, type: "closed" }),
        this.t("Branch closed on row {row}", { row }),
      );
      return;
    }

    if (picked.length < 2) {
      this.closing = { ...closing, picked };
      this.announce(this.t("Row {row} marked.", { row }));
      this.rerender();
      return;
    }

    const [first, second] = picked.map((each) => this.number(each));
    this.closing = null;
    this.focusTree = true;
    this.commit(
      setEnd(this.tree, closing.leaf, { cites: picked, type: "closed" }),
      this.t("Branch closed on rows {first} and {second}", {
        first: first ?? "?",
        second: second ?? "?",
      }),
    );
  }

  private openBranch(): void {
    const leaf = this.leafAtCursor();

    if (leaf === null) {
      return;
    }

    const end = this.index.nodes.get(leaf)?.end;

    if (end !== undefined) {
      this.reopen(leaf);
      return;
    }

    this.commit(
      setEnd(this.tree, leaf, { type: "open" }),
      this.t("Branch marked open and complete"),
    );
  }

  /**
   * Take a branch's end mark away. A cursor on the mark goes up to the
   * branch's last row, since the mark it was on is gone.
   */
  private reopen(leaf: string): void {
    // Remembered first, so that undo puts the cursor back on the mark.
    this.remember();

    if (this.cursor === leaf) {
      const rows = this.index.branchRows(leaf);
      this.cursor = rows[rows.length - 1]?.id ?? null;
    }

    this.tree = setEnd(this.tree, leaf, undefined);
    this.announce(this.t("Branch reopened."));
    this.edited();
  }

  private deleteRow(): void {
    // On an end mark, Delete takes the mark back.
    if (this.cursor !== null && this.isEnd(this.cursor)) {
      this.reopen(this.cursor);
      return;
    }

    const row = this.cursor;
    const index = this.index;
    const location = row === null ? null : index.row(row);

    if (row === null || location === null) {
      return;
    }

    if (this.isRootRow(row)) {
      this.refuse(
        this.t("The root's rows are given, and cannot be changed."),
      );
      return;
    }

    const above = index.rowsAbove(row);
    const parent = location.node.parent;
    const siblings = parent === null ? [] : index.children(parent);
    // A split's own row, alone in its branch: taking it back takes back the
    // whole split, since a split with one branch is not a split.
    const takesSplit =
      parent !== null &&
      siblings.length > 1 &&
      location.index === 0 &&
      siblings.every(
        (sibling) => sibling.rows[0]?.dev === location.row.dev,
      ) &&
      location.node.rows.every((each) => each.dev === location.row.dev);

    this.cursor = above[above.length - 1]?.id ?? null;
    this.commit(
      takesSplit && parent !== null
        ? removeChildren(this.tree, parent)
        : removeRow(this.tree, row),
      takesSplit ? this.t("Split taken back.") : this.t("Row deleted."),
    );
  }

  private undo(): void {
    const previous = this.past.pop();

    if (previous === undefined) {
      return;
    }

    this.future.push(this.snapshot());
    this.restoreSnapshot(previous);
    this.announce(this.t("Undone."));
    this.edited();
  }

  private redo(): void {
    const next = this.future.pop();

    if (next === undefined) {
      return;
    }

    this.past.push(this.snapshot());
    this.restoreSnapshot(next);
    this.announce(this.t("Redone."));
    this.edited();
  }

  private snapshot(): Snapshot {
    return { cursor: this.cursor, drafts: this.drafts, tree: this.tree };
  }

  private restoreSnapshot(snapshot: Snapshot): void {
    this.tree = snapshot.tree;
    this.drafts = snapshot.drafts;
    this.cursor =
      snapshot.cursor !== null &&
      (this.index.row(snapshot.cursor) !== null ||
        this.isEnd(snapshot.cursor))
        ? snapshot.cursor
        : this.lastRow();
    this.editing = null;
    this.citing = null;
    this.marginOf = null;
    this.closing = null;
    this.prompt = null;
  }

  // --- Fill mode ----------------------------------------------------------

  /** Develop the cursor's row on every open branch below it that lacks it. */
  private develop(): void {
    const resolved = this.resolved;
    const row = this.cursor;
    const index = this.index;
    const location = row === null ? null : index.row(row);

    if (resolved === null || row === null || location === null) {
      return;
    }

    const number = this.number(row);
    const read = resolved.reader.read(location.row.text);

    if (!read.ok) {
      this.refuse(
        this.t("Row {row} does not read, so it cannot be developed.", {
          row: number,
        }),
      );
      return;
    }

    const rule = ruleFor(read.formula, resolved.system);

    if (
      rule.type === "none" &&
      resolved.system.identity !== undefined &&
      nameIdentity(read.formula) !== null
    ) {
      this.prompt = { draft: "", row, type: "substitute" };
      this.rerender();
      return;
    }

    if (rule.type === "none") {
      this.refuse(
        this.t("Row {row} has no rule to develop.", { row: number }),
      );
      return;
    }

    const general =
      rule.type === "quantifier" && rule.rule.mark === "general";
    const targets = index
      .leaves(location.node.id)
      .filter(
        (leaf) =>
          leaf.end === undefined &&
          (general ||
            !index
              .branchRows(leaf.id)
              .some(
                (each) => each.cites.length === 1 && each.cites[0] === row,
              )),
      )
      .map((leaf) => leaf.id);

    if (targets.length === 0) {
      this.refuse(
        this.t(
          "Row {row} is already developed on every open branch below it.",
          {
            row: number,
          },
        ),
      );
      return;
    }

    if (rule.type === "quantifier") {
      this.prompt = {
        draft: this.suggestName(rule, targets),
        row,
        targets,
        type: "name",
      };
      this.rerender();
      return;
    }

    this.writeDevelopment(row, targets, rule.branches);
  }

  /** The name to offer: new to every target branch, or one already there. */
  private suggestName(
    rule: Extract<Rule, { type: "quantifier" }>,
    targets: readonly string[],
  ): string {
    const resolved = this.resolved;

    if (resolved === null) {
      return "";
    }

    const index = this.index;
    const onBranches = new Set<string>();

    for (const leaf of targets) {
      for (const each of index.branchRows(leaf)) {
        const read = resolved.reader.read(each.text);

        if (read.ok) {
          for (const name of namesIn(read.formula)) {
            onBranches.add(name);
          }
        }
      }
    }

    const names = languageNames(resolved.language);

    if (rule.rule.instance === "any") {
      const used = [...onBranches];
      return used[0] ?? names[0] ?? "";
    }

    return names.find((name) => !onBranches.has(name)) ?? "";
  }

  private commitName(prompt: Extract<Prompt, { type: "name" }>): void {
    const resolved = this.resolved;
    const location = this.index.row(prompt.row);

    if (resolved === null || location === null) {
      return;
    }

    const name = prompt.draft.trim();
    const term = parseTerm(name, resolved.language);
    const read = resolved.reader.read(location.row.text);

    if (!term.ok || term.term.type !== "constant" || !read.ok) {
      this.refuse(
        this.t("“{name}” is not a name in this language.", { name }),
      );
      return;
    }

    const rule = ruleFor(read.formula, resolved.system);

    if (rule.type !== "quantifier") {
      return;
    }

    const instance = substitute(rule.body, rule.variable, term.term);
    const written: Formula =
      rule.rule.yields === "negated-instance"
        ? { operand: instance, type: "not" }
        : instance;

    this.prompt = null;
    this.writeDevelopment(prompt.row, prompt.targets, [[written]]);
  }

  private commitSubstitute(
    prompt: Extract<Prompt, { type: "substitute" }>,
  ): void {
    const numbers = parseNumbers(prompt.draft);
    const line = numbers?.length === 1 ? numbers[0] : undefined;

    if (line === undefined) {
      this.refuse(this.t("Type row numbers, such as 3."));
      return;
    }

    this.substituteInto(prompt.row, line, null);
  }

  /**
   * Rewrite row `line` by the identity on `row`, on every open branch through
   * both, replacing `from` (or, if `null`, whichever of the identity's names
   * the row mentions, asking when it mentions both).
   */
  private substituteInto(row: string, line: number, from: string | null) {
    const resolved = this.resolved;
    const index = this.index;
    const layout = this.layout;
    const location = index.row(row);
    const identity =
      location === null ? null : resolved?.reader.read(location.row.text);
    const names =
      identity?.ok === true ? nameIdentity(identity.formula) : null;

    if (resolved === null || location === null || names === null) {
      return;
    }

    const number = this.number(row, layout);
    const writes: {
      leaf: string;
      cites: string[];
      formula: Formula;
    }[] = [];
    let found = false;

    for (const leaf of index.leaves(location.node.id)) {
      if (leaf.end !== undefined) {
        continue;
      }

      const branch = index.branchRows(leaf.id);
      const into = branch.find(
        (each) => layout.rows.get(each.id)?.line === line,
      );
      const read =
        into === undefined ? null : resolved.reader.read(into.text);

      if (into === undefined || read?.ok !== true) {
        continue;
      }

      found = true;
      const mentioned = namesIn(read.formula);
      const both =
        names.left !== names.right &&
        mentioned.includes(names.left) &&
        mentioned.includes(names.right);

      if (both && from === null) {
        this.prompt = {
          line,
          names: [names.left, names.right],
          row,
          type: "direction",
        };
        this.rerender();
        return;
      }

      const replaced =
        from ??
        (mentioned.includes(names.left)
          ? names.left
          : mentioned.includes(names.right)
            ? names.right
            : null);

      if (replaced === null || !mentioned.includes(replaced)) {
        continue;
      }

      const formula = replaceName(
        read.formula,
        replaced,
        replaced === names.left ? names.right : names.left,
      );
      const there = branch.some((each) => {
        const other = resolved.reader.read(each.text);
        return other.ok && sameFormula(other.formula, formula);
      });

      if (!there) {
        const cites = branch
          .filter((each) => each.id === row || each.id === into.id)
          .map((each) => each.id);
        writes.push({ cites, formula, leaf: leaf.id });
      }
    }

    this.prompt = null;

    if (writes.length === 0) {
      this.refuse(
        found
          ? this.t(
              "Substituting by row {row} into row {cited} writes nothing new on any open branch.",
              { cited: String(line), row: number },
            )
          : this.t(
              "Row {cited} is not on an open branch through row {row}.",
              {
                cited: String(line),
                row: number,
              },
            ),
      );
      return;
    }

    let tree = this.tree;
    let first: string | null = null;

    for (const write of writes) {
      const made = stackRows(
        tree,
        write.leaf,
        [
          {
            cites: write.cites,
            dev: this.mint(),
            text: displayFormula(write.formula, resolved.language),
          },
        ],
        this.mint,
      );

      tree = made.document;
      first ??= made.rows[0] ?? null;
    }

    this.remember();
    this.tree = tree;
    this.cursor = first ?? this.cursor;
    this.focusTree = true;
    this.announce(
      this.t("Row {cited} rewritten by the identity on row {row}.", {
        cited: String(line),
        row: number,
      }),
    );
    this.edited();
  }

  private writeDevelopment(
    row: string,
    targets: readonly string[],
    branches: readonly (readonly Formula[])[],
  ): void {
    const resolved = this.resolved;

    if (resolved === null) {
      return;
    }

    let tree = this.tree;
    let first: string | null = null;

    for (const leaf of targets) {
      const dev = this.mint();
      const drafts = branches.map((formulas) =>
        formulas.map((formula) => ({
          cites: [row],
          dev,
          text: displayFormula(formula, resolved.language),
        })),
      );
      const made =
        drafts.length === 1
          ? stackRows(tree, leaf, drafts[0] ?? [], this.mint)
          : splitNode(tree, leaf, drafts, this.mint);

      tree = made.document;
      first ??= made.rows[0] ?? null;
    }

    const number = this.number(row);

    this.remember();
    this.tree = tree;
    this.cursor = first ?? this.cursor;
    this.focusTree = true;
    this.announce(
      targets.length === 1
        ? this.t("Row {row} developed.", { row: number })
        : this.t("Row {row} developed on {count} branches.", {
            count: String(targets.length),
            row: number,
          }),
    );
    this.edited();
  }

  // --- Typing -------------------------------------------------------------

  private readonly onText = (rowId: string, text: string): void => {
    if (this.editPending && this.editing === rowId) {
      this.remember();
      this.editPending = false;
    }

    this.tree = setRowText(this.tree, rowId, text);
    this.setCheckStatus("");
    this.setMark("idle");
    this.syncAnswer();
    this.rerender();
  };

  private readonly onTextKey = (
    event: KeyboardEvent,
    rowId: string,
  ): void => {
    if (event.key === "Enter" || event.key === "Escape") {
      event.preventDefault();
      this.editing = null;
      this.focusTree = true;
      this.cursor = rowId;
      this.rerender();
      return;
    }

    if (event.altKey && keyAction(event) === "cite") {
      event.preventDefault();
      this.cursor = rowId;
      this.focusTree = true;
      this.startCiting();
    }
  };

  /**
   * Focus left an input for nowhere, and not by a click: something other
   * than the reader's Esc took it away, and it belongs back on the row. A
   * browser extension may take Esc itself and blur the input (Vimium does),
   * and focus left on the page's body sends the arrow keys to scrolling.
   */
  private strayBlur(event: FocusEvent): boolean {
    return event.relatedTarget === null && !this.pointing;
  }

  /**
   * Focus left a row being typed in: a click elsewhere, say. Typing is over,
   * or the input would linger and take focus back at the next arrow key. A
   * window losing focus is not the reader leaving the row.
   */
  private readonly onTextBlur = (rowId: string, event: FocusEvent): void => {
    if (this.editing === rowId && document.hasFocus()) {
      this.editing = null;
      this.cursor = rowId;
      this.focusTree = this.strayBlur(event);
      this.rerender();
    }
  };

  /**
   * A click on a row: the cursor goes there, and in type mode, typing. A
   * click on an end mark only moves the cursor there. While closing, the
   * circles are the only thing to click.
   */
  private readonly onRowClick = (rowId: string): void => {
    if (this.closing !== null) {
      return;
    }

    this.cursor = rowId;
    this.marginOf = null;

    if (this.isEnd(rowId)) {
      this.focusTree = true;
      this.rerender();
      return;
    }

    if (this.fill || this.isRootRow(rowId) || this.editing === rowId) {
      this.rerender();
      return;
    }

    this.focusTree = true;
    this.startEditing();
  };

  /** A click in a line's margin: type the citation of a row on that line. */
  private readonly onMargin = (line: number): void => {
    const layout = this.layout;
    const rows = (layout.lineRows.get(line) ?? []).filter(
      (row) => !this.isRootRow(row) && layout.heads.get(row) === row,
    );
    const row =
      this.cursor !== null && rows.includes(this.cursor)
        ? this.cursor
        : rows[0];

    if (row !== undefined) {
      this.cursor = row;
      this.marginOf = null;
      this.focusTree = true;
      this.startCiting();
    }
  };

  /** A key with the selection on a line's citation. */
  private readonly onMarginKey = (event: KeyboardEvent): void => {
    const action = keyAction(event);

    if (action !== null) {
      event.preventDefault();
      this.act(action);
    }
  };

  private readonly onCiteText = (text: string): void => {
    if (this.citing !== null) {
      this.citing = { ...this.citing, draft: text };
      this.rerender();
    }
  };

  private readonly onCiteKey = (event: KeyboardEvent): void => {
    const citing = this.citing;

    if (citing === null) {
      return;
    }

    // Enter and Esc alike keep what was typed and go back to the row; Tab
    // leaves as it would anywhere, and the blur keeps it too.
    if (event.key === "Enter" || event.key === "Escape") {
      event.preventDefault();
      this.commitCite(citing, true);
    }
  };

  /**
   * Focus left the citation: keep what was typed. Taken away as if by Esc,
   * focus goes back to the row as after Esc.
   */
  private readonly onCiteBlur = (event: FocusEvent): void => {
    const citing = this.citing;

    if (citing !== null && document.hasFocus()) {
      this.commitCite(citing, this.strayBlur(event));
    }
  };

  /**
   * Keep the typed citation for every row of the citing row's step: as the
   * rows it names if it names rows above, and otherwise as a draft the margin
   * shows squiggled, with the step uncited. `refocus` hands focus back to the
   * row: not when focus has already gone elsewhere.
   */
  private commitCite(
    citing: { row: string; draft: string },
    refocus: boolean,
  ): void {
    const index = this.index;
    const layout = this.layout;
    const location = index.row(citing.row);
    const text = citing.draft.trim();

    this.citing = null;
    this.focusTree = refocus;

    if (location === null || text === this.citationText(citing.row, layout)) {
      this.rerender();
      return;
    }

    const read = this.readCitation(text, index, layout, citing.row);
    const dev = location.row.dev;
    const drafts = new Map(this.drafts);
    // Every row of the step cites the same row, wherever the step put it.
    const step = index.document.nodes.flatMap((node) =>
      node.rows.filter((each) => each.dev === dev).map((each) => each.id),
    );
    const row = this.number(citing.row, layout);

    if (read.type === "cites") {
      drafts.delete(dev);
    } else {
      drafts.set(dev, { problem: read.problem, text });
    }

    this.remember();
    this.tree = setRowCites(
      this.tree,
      step,
      read.type === "cites" ? read.cites : [],
    );
    this.drafts = drafts;
    this.announce(
      read.type === "problem"
        ? read.problem
        : read.cites.length === 0
          ? this.t("Row {row} no longer cites a row.", { row })
          : read.cites.length === 2
            ? this.t("Row {row} now cites rows {cited} and {other}.", {
                cited: this.number(read.cites[0] ?? "", layout),
                other: this.number(read.cites[1] ?? "", layout),
                row,
              })
            : this.t("Row {row} now cites row {cited}.", {
                cited: text,
                row,
              }),
    );
    this.edited();
  }

  /** Typed row numbers as the rows above `rowId` they name, or what is wrong. */
  private readCitation(
    text: string,
    index: TableauIndex,
    layout: TableauLayout,
    rowId: string,
  ):
    | { readonly type: "cites"; readonly cites: string[] }
    | { readonly type: "problem"; readonly problem: string } {
    const numbers = parseNumbers(text);
    const location = index.row(rowId);

    if (numbers === null || location === null) {
      return {
        problem: this.t("Type row numbers, such as 3."),
        type: "problem",
      };
    }

    const cites: string[] = [];

    for (const number of numbers) {
      const found = rowAtLine(index, layout, location.node.id, number, rowId);

      if (found === null) {
        return {
          problem: this.t(
            "Row {cited} is not above this row on its branch.",
            {
              cited: String(number),
            },
          ),
          type: "problem",
        };
      }

      cites.push(found);
    }

    return { cites, type: "cites" };
  }

  private readonly onRowKey = (event: KeyboardEvent, rowId: string): void => {
    const action = keyAction(event);

    if (action === null) {
      return;
    }

    event.preventDefault();
    this.cursor = rowId;
    this.marginOf = null;
    this.act(action);
  };

  /**
   * A key on a closing circle. Up and down (Home and End) move between the
   * branch's circles, taking the cursor along; Space ticks, as a checkbox
   * does, and so does Enter; Esc, or x again, puts the closing away. Tab is
   * left alone, to go on to Cancel.
   */
  private readonly onCircleKey = (event: KeyboardEvent, rowId: string) => {
    const closing = this.closing;

    if (closing === null) {
      return;
    }

    const rows = this.index.branchRows(closing.leaf);
    const at = rows.findIndex((each) => each.id === rowId);
    const moves: Readonly<Record<string, number>> = {
      ArrowDown: at + 1,
      ArrowUp: at - 1,
      End: rows.length - 1,
      Home: 0,
    };
    const to = moves[event.key];

    if (to !== undefined) {
      event.preventDefault();
      const target = rows[Math.max(0, Math.min(rows.length - 1, to))];

      if (target !== undefined) {
        this.cursor = target.id;
        this.focusTree = true;
        this.rerender();
      }

      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      this.pick(rowId);
      return;
    }

    if (event.key === "Escape" || keyAction(event) === "close") {
      event.preventDefault();
      this.cancelClosing();
    }
  };

  // --- Rendering ----------------------------------------------------------

  private rerender(): void {
    const mount = this.mount;
    const data = this.data;
    const resolved = this.resolved;

    if (mount === null || data === null || resolved === null) {
      return;
    }

    const report = this.report();
    const layout = this.layout;

    // Hand focus to the cursor's row before the render, which may remove the
    // focused input (Esc, Enter or Tab out of typing) or row (a delete).
    // Browsers differ over where focus goes when its element is removed:
    // Firefox leaves the exercise, and the arrow keys then scroll the page,
    // before the view can move it back. A row already in place is never
    // removed out from under focus, so where it lands no longer depends on
    // the browser.
    if (this.focusTree) {
      this.cursorRow(mount)?.focus();
    }

    render(this.view(resolved, report, layout), mount);
    this.focusTree = false;

    if (this.prompt !== null) {
      mount.querySelector<HTMLInputElement>("[data-prompt-input]")?.focus();
    }
  }

  /**
   * The lines whose margin a click can cite from: in type mode, every line
   * below the root that begins a step. Fill mode writes the citations itself.
   */
  private citableLines(layout: TableauLayout): Set<number> {
    const lines = new Set<number>();

    if (this.fill) {
      return lines;
    }

    for (const [line, rows] of layout.lineRows) {
      if (
        layout.marginLines.has(line) &&
        rows.some((row) => !this.isRootRow(row))
      ) {
        lines.add(line);
      }
    }

    return lines;
  }

  /** What full feedback says about each row and end, as it is written. */
  private notes(
    report: TreeReport | null,
    layout: TableauLayout,
  ): Map<string, string> {
    const notes = new Map<string, string>();
    const index = this.index;

    // A citation that did not resolve says so whatever the feedback, as a
    // refusal would: it is the input, not the answer, that is wrong.
    for (const node of index.document.nodes) {
      for (const row of node.rows) {
        const draft = this.drafts.get(row.dev);

        if (draft !== undefined) {
          notes.set(row.id, draft.problem);
        }
      }
    }

    if (report === null || !this.showsDetail) {
      return notes;
    }

    const number = (rowId: string): string => this.number(rowId, layout);

    for (const [rowId, problem] of report.rows) {
      if (rowId === this.editing || notes.has(rowId)) {
        continue;
      }

      notes.set(
        rowId,
        describeRowProblem(
          problem,
          index.row(rowId)?.row.cites ?? [],
          this.words,
          number,
        ),
      );
    }

    for (const [nodeId, problem] of report.ends) {
      notes.set(nodeId, describeEndProblem(problem, this.words, number));
    }

    return notes;
  }

  /** The margins with the unresolved citations in them, squiggled. */
  private withDrafts(
    annotations: TableauAnnotations,
    layout: TableauLayout,
  ): TableauAnnotations {
    const index = this.index;
    const margins = new Map(annotations.margins);
    const flaggedMargins = new Set(annotations.flaggedMargins);

    for (const [line, rows] of layout.lineRows) {
      const draft = rows
        .filter((row) => layout.heads.get(row) === row)
        .map((row) => this.drafts.get(index.row(row)?.row.dev ?? ""))
        .find((each) => each !== undefined);

      if (draft !== undefined) {
        margins.set(line, draft.text);
        flaggedMargins.add(line);
      }
    }

    return { ...annotations, flaggedMargins, margins };
  }

  /** The cursor's row or end mark as drawn, if it is drawn yet. */
  private cursorRow(mount: HTMLElement): HTMLElement | undefined {
    return [...mount.querySelectorAll<HTMLElement>("[data-item]")].find(
      (item) => item.dataset.item === this.cursor,
    );
  }

  /**
   * The note shown under the tree: the cursor's row's, else its branch end's,
   * saying which row or branch it is about. (A row's own note, which its
   * description already places, is not.)
   */
  private cursorNote(
    notes: ReadonlyMap<string, string>,
    layout: TableauLayout,
  ): string | null {
    const index = this.index;
    const location = this.cursor === null ? null : index.row(this.cursor);

    if (location === null) {
      // An end mark: its own note, if any.
      const node =
        this.cursor === null ? undefined : index.nodes.get(this.cursor);
      const endNote = node === undefined ? undefined : notes.get(node.id);
      const rows = node === undefined ? [] : index.branchRows(node.id);
      const last = rows[rows.length - 1];

      return endNote === undefined || last === undefined
        ? null
        : this.t("The branch ending at row {row}: {problem}", {
            problem: endNote,
            row: this.number(last.id, layout),
          });
    }

    const rowNote = notes.get(location.row.id);

    if (rowNote !== undefined) {
      return this.t("Row {row}: {problem}", {
        problem: rowNote,
        row: this.number(location.row.id, layout),
      });
    }

    const endNote = notes.get(location.node.id);
    const last = location.node.rows[location.node.rows.length - 1];

    return endNote === undefined || last === undefined
      ? null
      : this.t("The branch ending at row {row}: {problem}", {
          problem: endNote,
          row: this.number(last.id, layout),
        });
  }

  private view(
    resolved: ResolvedTree,
    report: TreeReport | null,
    layout: TableauLayout,
  ) {
    const fill = this.fill;
    const annotations =
      report === null
        ? null
        : this.withDrafts(
            treeAnnotations(
              this.tree,
              layout,
              report,
              resolved.language,
              this.words,
              { flag: this.showsDetail, rootRows: resolved.root.length },
            ),
            layout,
          );
    const notes = this.notes(report, layout);
    const note = this.cursorNote(notes, layout);
    const button = (
      label: TruthTreeStringId,
      icon: ToolbarIconName,
      action: TableauKeyAction,
    ) => (
      <button
        aria-label={this.t(label)}
        aria-pressed={action === "close" ? this.closing !== null : undefined}
        key={action}
        onClick={() => this.act(action)}
        title={this.t(label)}
        type="button"
      >
        <ToolbarIcon name={icon} />
      </button>
    );

    return (
      <div class="truth-tree-editor">
        <div
          aria-label={this.t("Tree actions")}
          class="proof-toolbar truth-tree-toolbar"
          role="toolbar"
        >
          {fill
            ? button("Develop", "tree-develop", "develop")
            : [
                button("Stack", "tree-stack", "stack"),
                button("Split", "tree-split", "split"),
                button("Add row", "tree-add-row", "add-row"),
              ]}
          <span class="proof-toolbar-sep" />
          {button("Close", "tree-close", "close")}
          {button("Mark open", "tree-open", "open")}
          {button("Delete", "tree-delete", "delete")}
          <span class="proof-toolbar-sep" />
          <button
            aria-label={this.t("Undo")}
            disabled={this.past.length === 0}
            onClick={() => this.act("undo")}
            title={this.t("Undo")}
            type="button"
          >
            <ToolbarIcon name="undo" />
          </button>
          <button
            aria-label={this.t("Redo")}
            disabled={this.future.length === 0}
            onClick={() => this.act("redo")}
            title={this.t("Redo")}
            type="button"
          >
            <ToolbarIcon name="redo" />
          </button>
        </div>
        {annotations === null ? null : (
          <TableauView
            annotations={annotations}
            citable={this.citableLines(layout)}
            citing={this.citing}
            cursor={this.cursor}
            document={this.tree}
            editing={this.editing}
            focus={this.focusTree}
            inputLabels={{
              cites: this.t("Cites row"),
              text: this.t("Sentence on row {row}", {
                row:
                  this.editing === null
                    ? "?"
                    : this.number(this.editing, layout),
              }),
            }}
            label={this.t("Truth tree")}
            layout={layout}
            notes={notes}
            onCiteKey={this.onCiteKey}
            onCiteText={this.onCiteText}
            onCiteBlur={this.onCiteBlur}
            onCursor={this.onRowClick}
            marginStop={
              this.onMarginStop() && this.cursor !== null
                ? {
                    label: this.marginLabel(this.cursor, layout),
                    line: layout.rows.get(this.cursor)?.line ?? 0,
                  }
                : undefined
            }
            onMargin={this.onMargin}
            onMarginKey={this.onMarginKey}
            onRowKey={this.onRowKey}
            onText={this.onText}
            onTextBlur={this.onTextBlur}
            onTextKey={this.onTextKey}
            picking={
              this.closing === null
                ? undefined
                : {
                    among: new Set(
                      this.index
                        .branchRows(this.closing.leaf)
                        .map((each) => each.id),
                    ),
                    picked: new Set(this.closing.picked),
                    label: (rowId: string) =>
                      this.t("Close the branch on row {row}", {
                        row: this.number(rowId, layout),
                      }),
                    onKey: this.onCircleKey,
                    onPick: (rowId: string) => this.pick(rowId),
                  }
            }
          />
        )}
        {this.closing === null ? null : (
          <div class="truth-tree-prompt" data-role="closing">
            <p>{this.closingHint()}</p>
            <button onClick={() => this.cancelClosing()} type="button">
              {this.t("Cancel")}
            </button>
          </div>
        )}
        {this.prompt === null ? null : this.promptView(this.prompt)}
        {note === null ? null : (
          <p class="truth-tree-note" data-role="note">
            {note}
          </p>
        )}
        <p aria-live="polite" class="visually-hidden" data-role="announce">
          {this.announcement}
        </p>
      </div>
    );
  }

  private promptView(prompt: Prompt) {
    const putAway = (): void => {
      this.prompt = null;
      this.focusTree = true;
      this.rerender();
    };

    if (prompt.type === "direction") {
      const [left, right] = prompt.names;
      const language = this.resolved?.language;
      const shown = (name: string): string =>
        language === undefined ? name : displayName(name, language);
      const choice = (from: string, to: string, first: boolean) => (
        <button
          data-prompt-input={first ? "" : undefined}
          onClick={() => this.substituteInto(prompt.row, prompt.line, from)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              putAway();
            }
          }}
          type="button"
        >
          {this.t("Replace {from} with {to}", {
            from: shown(from),
            to: shown(to),
          })}
        </button>
      );

      return (
        <div class="truth-tree-prompt">
          {choice(left, right, true)}
          {choice(right, left, false)}
          <button onClick={putAway} type="button">
            {this.t("Cancel")}
          </button>
        </div>
      );
    }

    const label =
      prompt.type === "name"
        ? this.t("Name for the instance")
        : this.t("Row to rewrite by this identity");
    const commit = (): void => {
      const current = this.prompt;

      if (current?.type === "name") {
        this.commitName(current);
      } else if (current?.type === "substitute") {
        this.commitSubstitute(current);
      }
    };

    return (
      <div class="truth-tree-prompt">
        <label>
          <span>{label}</span>
          <input
            autocomplete="off"
            data-prompt-input=""
            inputMode={prompt.type === "substitute" ? "numeric" : undefined}
            onBlur={(event) => {
              // Taken away as if by Esc: as Esc, put the question away. Not
              // when the question has become another (a row number, then
              // which name to replace), whose render removes this input.
              if (
                this.prompt?.type === prompt.type &&
                document.hasFocus() &&
                this.strayBlur(event)
              ) {
                putAway();
              }
            }}
            onInput={(event) => {
              const current = this.prompt;

              if (current !== null && current.type !== "direction") {
                this.prompt = {
                  ...current,
                  draft: event.currentTarget.value,
                };
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit();
              } else if (event.key === "Escape") {
                event.preventDefault();
                putAway();
              }
            }}
            spellcheck={false}
            type="text"
            value={prompt.draft}
          />
        </label>
        <button onClick={commit} type="button">
          {this.t("Done")}
        </button>
      </div>
    );
  }
}

register("carnap-truth-tree", CarnapTruthTree);
