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
 * and works on that row's branch. The student writes each step: Stack or
 * Split, then the rows' sentences, then, in the margin, the row they develop
 * and the rule they use.
 * Closing a branch cites its two rows, or its one row `a≠a`; ↑ marks one open
 * and complete.
 *
 * The mouse follows the proof tree's conventions: a click on a row types in
 * it, a click in its margin types its citation, and a click elsewhere ends
 * the typing, so the arrow keys move between rows again. The ring shows
 * when they do.
 *
 * The tree is written down as a derivation (`aufbau/emit.ts`) and compiled
 * by the engine once the edits pause, as a proof is: full feedback flags a
 * step or closure the engine refused on the row or end it is about, and the
 * certificate the compile produced is what the server verifies at submit.
 * A general step's instances are asked of the engine first: each row it
 * wrote is stated, in a link theorem, to be its rule's instance at each term
 * it could be, and the links that hold say which it was. Those go in the
 * answer, and into the certificate, so the server confirms them too.
 * What the engine does not see (the root, unreadable rows, where ends sit)
 * is checked on every edit by the same `judgeTree` the grader runs. Marks
 * are computed; the margin's citation and rule are typed. As with the model,
 * there is no answer key: the Check is `judgeTree` over public data.
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
import type {
  MarginField,
  MarginNote,
  TableauAnnotations,
} from "../../tableau/html";
import type { TableauLayout } from "../../tableau/layout";
import { layoutTableau, rowAtLine } from "../../tableau/layout";
import type { TableauKeyAction } from "../../tableau/navigate";
import { keyAction, moveCursor } from "../../tableau/navigate";
import { treeAnnotations } from "../../worker/exercises/truth-tree/annotations";
import { closesAlone } from "../../worker/exercises/truth-tree/aufbau/complete";
import type { TreeProof } from "../../worker/exercises/truth-tree/aufbau/emit";
import {
  heldInstances,
  readTreeDiagnostics,
} from "../../worker/exercises/truth-tree/aufbau/emit";
import type { TreeEvidence } from "../../worker/exercises/truth-tree/aufbau/judge";
import { ruleSpelling } from "../../worker/exercises/truth-tree/aufbau/theory";
import type { ResolvedTree } from "../../worker/exercises/truth-tree/grading";
import {
  answerRules,
  isTruthTreeAnswerData,
  isTruthTreePublicData,
  judgeTree,
  resolveTruthTree,
  startingTree,
  startsFromRoot,
  treeProofOf,
} from "../../worker/exercises/truth-tree/grading";
import type { TreeReport } from "../../worker/exercises/truth-tree/logic/check";
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
import { register } from "./base";
import islandStyles from "./carnap-truth-tree-v1.css" with { type: "text" };
import {
  createHelpDialog,
  HELP_DIALOG_STYLES,
  mountHelpTrigger,
  openHelpDialog,
} from "./help-dialog";
import { mountProblemPopup } from "./problem-popup";
import { ProofExerciseElement } from "./proof-element";
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
  /**
   * The tree as a derivation, and its rules and instances as they were when
   * it was made.
   */
  proof?: {
    readonly rules: ReadonlyMap<string, string>;
    readonly instances: ReadonlyMap<string, string>;
    readonly proof: TreeProof;
  };
  /** The report, and the evidence it was made with. */
  report?: {
    readonly evidence: TreeEvidence;
    readonly report: TreeReport | null;
  };
}

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
 * A margin field typed that does not resolve: a citation of `3,` or of a row
 * not above, or a rule the theory has no name for. The step stays uncited, or
 * ruleless, and the margin keeps the text, squiggled, until it is put right.
 * Editor state, not answer: a reload keeps the tree and its rules only.
 */
interface MarginDraft {
  readonly text: string;
  readonly problem: string;
}

/** The margin fields being typed: the row whose step it is, and the draft. */
interface Citing {
  readonly row: string;
  readonly draft: string;
  readonly field: MarginField;
}

interface Snapshot {
  readonly tree: TableauDocument;
  readonly cursor: string | null;
  /** The rule each development names. */
  readonly rules: ReadonlyMap<string, string>;
  /** The steps' unresolved citations and rules, by development. */
  readonly drafts: Readonly<
    Record<MarginField, ReadonlyMap<string, MarginDraft>>
  >;
}

interface Shortcut {
  readonly action: TruthTreeStringId;
  readonly icon?: ToolbarIconName;
  readonly keys: readonly string[];
}

const SHORTCUTS: readonly Shortcut[] = [
  { action: "Move between rows", keys: ["←", "→", "↑", "↓"] },
  { action: "Write the row's sentence", keys: ["Enter"] },
  {
    action:
      "Type the row it develops; Alt-C also works while writing the row",
    keys: ["c", "Alt-C"],
  },
  {
    action: "Type the rule it uses; Alt-J also works while writing the row",
    keys: ["j", "Alt-J"],
  },
  {
    action:
      "From the end of a line, go on to its citation, then its rule; Delete clears either",
    keys: ["→"],
  },
  {
    action: "From the citation being typed, go on to the rule",
    keys: ["Tab"],
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

class CarnapTruthTree extends ProofExerciseElement<TruthTreeStringId> {
  private data: TruthTreePublicData | null = null;
  private resolved: ResolvedTree | null = null;
  private mount: HTMLElement | null = null;
  private helpDialog: HTMLDialogElement | null = null;

  private tree: TableauDocument = { nodes: [] };
  private derived: Derived | null = null;
  /** What the engine said of the tree as it stands; `none` until it has. */
  private evidence: TreeEvidence = { kind: "none" };
  private rules: ReadonlyMap<string, string> = new Map();
  /**
   * The instance each row of a general step was written with, as the last
   * compile found; empty until it has run.
   */
  private instances: ReadonlyMap<string, string> = new Map();
  private drafts: Snapshot["drafts"] = { cites: new Map(), rule: new Map() };
  private past: Snapshot[] = [];
  private future: Snapshot[] = [];
  private cursor: string | null = null;
  private editing: string | null = null;
  /**
   * An edit begun on an existing row, whose undo step is recorded at its
   * first keystroke, so that opening a row and leaving it records nothing.
   */
  private editPending = false;
  private citing: Citing | null = null;
  /**
   * The row whose margin the selection is on, while the cursor is that row:
   * the arrows reach a line's citation, and its rule after it, as they reach
   * its rows. Any move of the cursor elsewhere leaves it.
   */
  private marginOf: string | null = null;
  /** Which of the margin's fields the selection is on. */
  private marginField: MarginField = "cites";
  private closing: Closing | null = null;
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

    this.helpDialog = createHelpDialog({
      close: this.t("Close help"),
      intro: [
        this.t(
          "Move to a row with the arrow keys or by clicking it; each action works on the row or branch there.",
        ),
        this.t(
          "Write each step's rows, choosing whether they stack on the branch or split it, and type the row they develop and the rule they use in the margin.",
        ),
        resolved.finish === "closed"
          ? this.t(
              "Close a branch on a sentence and its negation, citing both rows. The tree is done when every branch is closed.",
            )
          : resolved.finish === "complete"
            ? this.t(
                "Close a branch on a sentence and its negation, citing both rows, and mark each complete open branch ↑. The tree is done when every branch is closed or marked open.",
              )
            : this.t(
                "Close a branch on a sentence and its negation, citing both rows, and mark a complete open branch ↑. The tree is done when every branch is closed, or one is marked open.",
              ),
      ],
      keyboard: this.t("Keyboard"),
      shortcuts: SHORTCUTS.filter(
        (shortcut) => shortcut.icon !== "tree-open" || this.offersOpen,
      ).map((shortcut) => ({
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
    this.gateSubmit((event) => this.gate(event));
    this.scheduleCompile();

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

  override disconnectedCallback(): void {
    super.disconnectedCallback();
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
    const usable =
      isTruthTreeAnswerData(prior) && startsFromRoot(prior, resolved);
    const saved = usable ? { nodes: prior.nodes } : startingTree(resolved);
    const rules = usable ? answerRules(prior) : new Map<string, string>();

    this.tree = remint(saved, this.mint);
    this.cursor = this.lastRow();

    // Each development's rule follows it to its fresh id: a row keeps its
    // place, so the old document's rows line up with the new one's.
    const fresh = new Map<string, string>();
    const before = saved.nodes.flatMap((node) => node.rows);
    const after = this.tree.nodes.flatMap((node) => node.rows);

    for (const [at, row] of before.entries()) {
      const now = after[at];

      if (now !== undefined) {
        fresh.set(row.dev, now.dev);
      }
    }

    this.rules = new Map(
      [...rules].flatMap(([dev, rule]) => {
        const now = fresh.get(dev);
        return now === undefined ? [] : [[now, rule] as const];
      }),
    );
  }

  /** The last row of the tree in tree order: a sensible place to start. */
  private lastRow(): string | null {
    const order = this.index.preorder();
    const rows = order.flatMap((node) => node.rows);
    return rows[rows.length - 1]?.id ?? null;
  }

  /** Whether a branch may be marked open: not where every one is to close. */
  private get offersOpen(): boolean {
    return this.resolved !== null && this.resolved.finish !== "closed";
  }

  /**
   * The instances, like the certificate, are what the engine made of the
   * tree, not what the student wrote: an answer that gains them when a
   * compile lands is no less saved than it was.
   */
  protected override authoredAnswer(): string {
    const {
      instances: _instances,
      mmb: _mmb,
      ...authored
    } = this.getAnswer();
    return JSON.stringify(authored);
  }

  protected getAnswer(): TruthTreeAnswerData & { readonly mmb?: string } {
    // Only the rules of developments, and the instances of rows, still in
    // the tree.
    const rows = this.tree.nodes.flatMap((node) => node.rows);
    const devs = new Set(rows.map((row) => row.dev));
    const ids = new Set(rows.map((row) => row.id));
    const rules = [...this.rules].filter(([dev]) => devs.has(dev));
    const instances = [...this.instances].filter(([id]) => ids.has(id));

    return {
      ...(instances.length === 0
        ? {}
        : { instances: Object.fromEntries(instances) }),
      ...(this.mmb === "" ? {} : { mmb: this.mmb }),
      nodes: this.tree.nodes,
      ...(rules.length === 0 ? {} : { rules: Object.fromEntries(rules) }),
    };
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

  /** The tree as a derivation, made once per tree, rules and instances. */
  private proof(resolved: ResolvedTree): TreeProof {
    const derived = this.derive();

    if (
      derived.proof?.rules !== this.rules ||
      derived.proof.instances !== this.instances
    ) {
      derived.proof = {
        instances: this.instances,
        proof: treeProofOf(resolved, this.getAnswer()),
        rules: this.rules,
      };
    }

    return derived.proof.proof;
  }

  private judgement(resolved: ResolvedTree) {
    return judgeTree(
      resolved,
      this.getAnswer(),
      this.evidence,
      this.proof(resolved),
    );
  }

  private report(): TreeReport | null {
    const resolved = this.resolved;
    const derived = this.derive();

    if (derived.report?.evidence !== this.evidence) {
      derived.report = {
        evidence: this.evidence,
        report: resolved === null ? null : this.judgement(resolved).report,
      };
    }

    return derived.report.report;
  }

  /**
   * Compile the tree's derivation, and take what the engine says as the
   * evidence the report is made with. A tree with nothing written below its
   * root has nothing to compile.
   *
   * The first compile also asks which instance each general row was written
   * with: it states every candidate, and a link that fails says only that the
   * row was not that one. The instances that hold are kept, and when the
   * derivation stating only those differs from the one asked, it is compiled
   * again for the certificate.
   */
  protected async compile(): Promise<void> {
    const resolved = this.resolved;
    const mm0 = this.data?.mm0;

    if (resolved === null || mm0 === undefined) {
      return;
    }

    const tree = this.tree;
    const rules = this.rules;
    const answer = { nodes: tree.nodes, rules: Object.fromEntries(rules) };
    const slots = treeProofOf(resolved, answer, new Map()).slots;
    const asking = treeProofOf(resolved, answer, slots);

    if (asking.goal === null || asking.proof === null) {
      this.instances = new Map();
      this.evidence = { certified: false, errors: [], kind: "compiled" };
      this.rerender();
      return;
    }

    const stale = () => this.tree !== tree || this.rules !== rules;
    const asked = await this.runCompiler(
      `${mm0}\n${asking.goal}\n`,
      asking.proof,
    );

    if (asked === null || stale()) {
      return;
    }

    if (asked.kind !== "verdict") {
      this.evidence = { kind: "none" };
      this.syncAnswer();
      this.rerender();
      return;
    }

    const errors = readTreeDiagnostics(asked.verdict.problems, asking);
    const instances = heldInstances(asking, errors);

    this.instances = instances;

    const final = this.proof(resolved);
    const stepErrors = errors.filter(
      (error) => error.subject?.type !== "link",
    );
    let certified = asked.verdict.certificate !== null;

    if (
      stepErrors.length === 0 &&
      final.goal !== null &&
      final.proof !== null &&
      (final.goal !== asking.goal || final.proof !== asking.proof)
    ) {
      const run = await this.runCompiler(
        `${mm0}\n${final.goal}\n`,
        final.proof,
      );

      if (run === null || stale()) {
        return;
      }

      certified = run.kind === "verdict" && run.verdict.certificate !== null;
    }

    this.evidence = { certified, errors: stepErrors, kind: "compiled" };
    this.syncAnswer();
    this.rerender();
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

  private async runCheck(): Promise<void> {
    const resolved = this.resolved;

    if (resolved === null) {
      return;
    }

    // The engine's word on the tree as it stands, first.
    await this.settled();

    const judgement = this.judgement(resolved);

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
    this.forgetVerdict();
    this.evidence = { kind: "none" };
    this.instances = new Map();
    this.setMark("idle");
    this.syncAnswer();
    this.scheduleCompile();
    this.rerender();
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
        this.marginField = "cites";
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

  /** Whether the selection is on a margin field rather than a row. */
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
   * A key with the selection on a margin field: → goes on from the citation
   * to the rule, ← back to the citation and from it to the line's rows, ↑
   * and ↓ to the same field of the lines above and below, Enter types it (or
   * c the citation, j the rule), and Delete clears it (the row stays).
   * `false` for any other action, which leaves the margin for its row.
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
        if (this.marginField === "rule") {
          this.marginField = "cites";
          return true;
        }

        this.cursor =
          rightmost(layout.lineRows.get(line) ?? [], layout) ?? this.cursor;
        this.marginOf = null;
        return true;
      }
      case "right":
        this.marginField = "rule";
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
        this.startMargin(this.marginField);
        return true;
      case "cite":
        this.startMargin("cites");
        return true;
      case "rule":
        this.startMargin("rule");
        return true;
      case "delete":
        this.commitMargin(
          { draft: "", field: this.marginField, row: this.cursor },
          true,
        );
        return true;
      default:
        return false;
    }
  }

  /** The actions that change the tree, or start to. */
  private command(action: TableauKeyAction): void {
    // Any other action puts away a closing half marked.
    if (this.closing !== null && action !== "close") {
      this.closing = null;
    }

    const commands: Partial<Record<TableauKeyAction, () => void>> = {
      "add-row": () => this.addRow(),
      cite: () => this.startMargin("cites"),
      close: () => this.closeBranch(),
      delete: () => this.deleteRow(),
      edit: () => this.startEditing(),
      open: () => this.openBranch(),
      redo: () => this.redo(),
      rule: () => this.startMargin("rule"),
      split: () => this.split(),
      stack: () => this.stack(),
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

    if (row === null) {
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

  /** Type a field of the margin of the step at the cursor. */
  private startMargin(field: MarginField): void {
    const row = this.cursorRowId();

    if (row === null) {
      return;
    }

    if (this.isRootRow(row)) {
      this.refuse(
        this.t("The root's rows are given, and cannot be changed."),
      );
      return;
    }

    // A step is justified once, beside its first row.
    const head = this.layout.heads.get(row) ?? row;

    this.editing = null;
    this.citing = { draft: this.fieldText(head, field), field, row: head };
    this.rerender();
  }

  /** A margin field's name, for the selection on it. */
  private marginLabel(
    rowId: string,
    layout: TableauLayout,
    field: MarginField,
  ): string {
    const row = this.number(rowId, layout);

    if (field === "rule") {
      const rule = this.fieldText(rowId, "rule", layout);

      return rule === ""
        ? this.t("Rule of row {row}, not yet named", { row })
        : this.t("Rule of row {row}: {rule}", { row, rule });
    }

    const cites = this.fieldText(rowId, "cites", layout);

    return cites === ""
      ? this.t("Citation of row {row}, not yet written", { row })
      : this.t("Citation of row {row}: {cites}", { cites, row });
  }

  /**
   * A field of a row's margin as it shows: its draft, or the step's
   * citation as numbers, or the rule it names.
   */
  private fieldText(rowId: string, field: MarginField, layout = this.layout) {
    const row = this.index.row(rowId)?.row;

    if (row === undefined) {
      return "";
    }

    const draft = this.drafts[field].get(row.dev)?.text;

    if (draft !== undefined) {
      return draft;
    }

    return field === "rule"
      ? (this.rules.get(row.dev) ?? "")
      : row.cites.map((cite) => this.number(cite, layout)).join(", ");
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
    // A row closes a branch alone where the theory's closure rule says so.
    const resolved = this.resolved;

    if (
      picked.length === 1 &&
      resolved !== null &&
      closesAlone(
        resolved.development,
        resolved.reader,
        index.row(rowId)?.row.text ?? "",
      )
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
    // Where every branch is to close, a branch is not marked open.
    if (!this.offersOpen) {
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
    return {
      cursor: this.cursor,
      drafts: this.drafts,
      rules: this.rules,
      tree: this.tree,
    };
  }

  private restoreSnapshot(snapshot: Snapshot): void {
    this.tree = snapshot.tree;
    this.drafts = snapshot.drafts;
    this.rules = snapshot.rules;
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
  }

  // --- Typing -------------------------------------------------------------

  private readonly onText = (rowId: string, text: string): void => {
    if (this.editPending && this.editing === rowId) {
      this.remember();
      this.editPending = false;
    }

    this.tree = setRowText(this.tree, rowId, text);
    this.edited();
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

    const action = event.altKey ? keyAction(event) : null;

    if (action === "cite" || action === "rule") {
      event.preventDefault();
      this.cursor = rowId;
      this.focusTree = true;
      this.startMargin(action === "cite" ? "cites" : "rule");
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

    if (this.isRootRow(rowId) || this.editing === rowId) {
      this.rerender();
      return;
    }

    this.focusTree = true;
    this.startEditing();
  };

  /**
   * A click on a field of a line's margin: type the citation, or the rule, of
   * a row on that line.
   */
  private readonly onMargin = (line: number, field: MarginField): void => {
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
      this.startMargin(field);
    }
  };

  /** A key with the selection on a line's margin. */
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

    // Enter and Esc alike keep what was typed and go back to the row. Tab
    // goes on from the citation to the rule, and Shift-Tab back, as in the
    // book's margin; Tab from the rule leaves as it would anywhere, and the
    // blur keeps what was typed too.
    if (event.key === "Enter" || event.key === "Escape") {
      event.preventDefault();
      this.commitMargin(citing, true);
      return;
    }

    const next =
      event.key !== "Tab"
        ? null
        : !event.shiftKey && citing.field === "cites"
          ? "rule"
          : event.shiftKey && citing.field === "rule"
            ? "cites"
            : null;

    if (next !== null) {
      event.preventDefault();
      this.commitMargin(citing, true);
      this.cursor = citing.row;
      this.focusTree = true;
      this.startMargin(next);
    }
  };

  /**
   * Focus left a margin field: keep what was typed. Taken away as if by Esc,
   * focus goes back to the row as after Esc. A blur from the field just left
   * for the other one (Tab) is not this field's.
   */
  private readonly onCiteBlur = (event: FocusEvent): void => {
    const citing = this.citing;
    const input =
      citing?.field === "rule" ? "tableau-rule-input" : "tableau-cite-input";

    if (
      citing !== null &&
      document.hasFocus() &&
      (event.target as Element | null)?.classList.contains(input) !== false
    ) {
      this.commitMargin(citing, this.strayBlur(event));
    }
  };

  /** Keep what was typed in a margin field. */
  private commitMargin(citing: Citing, refocus: boolean): void {
    if (citing.field === "rule") {
      this.commitRule(citing, refocus);
    } else {
      this.commitCite(citing, refocus);
    }
  }

  /**
   * Keep the typed rule for the step: as the rule the theory spells it, if it
   * names one, and otherwise as a draft the margin shows squiggled, with the
   * step left without a rule. `refocus` as for {@link commitCite}.
   */
  private commitRule(citing: Citing, refocus: boolean): void {
    const location = this.index.row(citing.row);
    const text = citing.draft.trim();
    const language = this.resolved?.language;

    this.citing = null;
    this.focusTree = refocus;

    if (
      location === null ||
      language === undefined ||
      text === this.fieldText(citing.row, "rule")
    ) {
      this.rerender();
      return;
    }

    const dev = location.row.dev;
    const spelled = text === "" ? null : ruleSpelling(language, text);
    const rules = new Map(this.rules);
    const drafts = new Map(this.drafts.rule);
    const row = this.number(citing.row);
    let announcement: string;

    if (spelled !== null) {
      rules.set(dev, spelled);
      drafts.delete(dev);
      announcement = this.t("Row {row} now names the rule {rule}.", {
        row,
        rule: spelled,
      });
    } else if (text === "") {
      rules.delete(dev);
      drafts.delete(dev);
      announcement = this.t("Row {row} no longer names a rule.", { row });
    } else {
      rules.delete(dev);
      announcement = this.t("This system has no rule called “{rule}”.", {
        rule: text,
      });
      drafts.set(dev, { problem: announcement, text });
    }

    this.remember();
    this.rules = rules;
    this.drafts = { ...this.drafts, rule: drafts };
    this.announce(announcement);
    this.edited();
  }

  /**
   * Keep the typed citation for every row of the citing row's step: as the
   * rows it names if it names rows above, and otherwise as a draft the margin
   * shows squiggled, with the step uncited. `refocus` hands focus back to the
   * row: not when focus has already gone elsewhere.
   */
  private commitCite(citing: Citing, refocus: boolean): void {
    const index = this.index;
    const layout = this.layout;
    const location = index.row(citing.row);
    const text = citing.draft.trim();

    this.citing = null;
    this.focusTree = refocus;

    if (
      location === null ||
      text === this.fieldText(citing.row, "cites", layout)
    ) {
      this.rerender();
      return;
    }

    const read = this.readCitation(text, index, layout, citing.row);
    const dev = location.row.dev;
    const drafts = new Map(this.drafts.cites);
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
    this.drafts = { ...this.drafts, cites: drafts };
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
  }

  /**
   * The lines whose margin a click can cite from: every line below the root
   * that begins a step.
   */
  private citableLines(layout: TableauLayout): Set<number> {
    const lines = new Set<number>();

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

    // A citation or rule that did not resolve says so whatever the feedback,
    // as a refusal would: it is the input, not the answer, that is wrong.
    for (const node of index.document.nodes) {
      for (const row of node.rows) {
        const draft =
          this.drafts.cites.get(row.dev) ?? this.drafts.rule.get(row.dev);

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

  /** The margins with the unresolved citations and rules in them, squiggled. */
  private withDrafts(
    annotations: TableauAnnotations,
    layout: TableauLayout,
  ): TableauAnnotations {
    const index = this.index;
    const margins = new Map<number, MarginNote>(annotations.margins);
    const flags: Record<MarginField, Set<number>> = {
      cites: new Set(annotations.flaggedMargins),
      rule: new Set(annotations.flaggedRules),
    };

    for (const [line, rows] of layout.lineRows) {
      const devs = rows
        .filter((row) => layout.heads.get(row) === row)
        .map((row) => index.row(row)?.row.dev ?? "");

      for (const field of ["cites", "rule"] as const) {
        const draft = devs
          .map((dev) => this.drafts[field].get(dev))
          .find((each) => each !== undefined);

        if (draft !== undefined) {
          margins.set(line, {
            ...(margins.get(line) ?? { cites: "", rule: "" }),
            [field]: draft.text,
          });
          flags[field].add(line);
        }
      }
    }

    return {
      ...annotations,
      flaggedMargins: flags.cites,
      flaggedRules: flags.rule,
      margins,
    };
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
              {
                flag: this.showsDetail,
                rootRows: resolved.root.length,
                rules: this.rules,
              },
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
          {button("Stack", "tree-stack", "stack")}
          {button("Split", "tree-split", "split")}
          {button("Add row", "tree-add-row", "add-row")}
          <span class="proof-toolbar-sep" />
          {button("Close", "tree-close", "close")}
          {this.offersOpen ? button("Mark open", "tree-open", "open") : null}
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
              rule: this.t("Rule used"),
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
                    field: this.marginField,
                    label: this.marginLabel(
                      this.cursor,
                      layout,
                      this.marginField,
                    ),
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
}

register("carnap-truth-tree", CarnapTruthTree);
