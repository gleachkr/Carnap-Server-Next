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
 * Closing a branch cites the rows a closure rule closes it on (UBC's sentence
 * and its negation, or `a≠a` alone); ↑ marks one open and complete.
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
 * answer, and into the certificate, so the server confirms them too. So is
 * whether a branch marked open is complete: a theorem for each row, which
 * the engine proves only if it is, so a branch it is not shows what it is
 * missing and certifies no tree. An identity is developed one way round,
 * and both are asked; the way refused least goes in the answer too. What the engine does not see (the root, unreadable rows, where ends sit)
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
import type { MarginField } from "../../tableau/html";
import type { TableauLayout } from "../../tableau/layout";
import { layoutTableau } from "../../tableau/layout";
import type { TableauKeyAction } from "../../tableau/navigate";
import { keyAction, moveCursor } from "../../tableau/navigate";
import {
  isRootRow,
  treeAnnotations,
} from "../../worker/exercises/truth-tree/annotations";
import {
  askingProofOf,
  readAsked,
} from "../../worker/exercises/truth-tree/ask";
import {
  closesBranch,
  closureArities,
} from "../../worker/exercises/truth-tree/aufbau/branch";
import {
  pairingKey,
  pairingOf,
} from "../../worker/exercises/truth-tree/aufbau/developed";
import type { TreeProof } from "../../worker/exercises/truth-tree/aufbau/emit";
import type {
  EngineFailure,
  TreeEvidence,
} from "../../worker/exercises/truth-tree/aufbau/judge";
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
import { displayName } from "../../worker/exercises/truth-tree/labels";
import type { TreeReport } from "../../worker/exercises/truth-tree/report";
import type { TruthTreeStringId } from "../../worker/exercises/truth-tree/strings";
import type {
  TruthTreeAnswerData,
  TruthTreePublicData,
} from "../../worker/exercises/truth-tree/types";
import type { TreeWords } from "../../worker/exercises/truth-tree/verdict-text";
import {
  atBranchEnd,
  atRow,
  describeEndProblem,
  describeJudgement,
  describeRowProblem,
  engineFailureText,
  layoutNumbers,
} from "../../worker/exercises/truth-tree/verdict-text";
import { TableauView } from "../tableau/view";
import { mountActionButton } from "./action-bar";
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
import {
  type Closing,
  circleMove,
  closedOn,
  pick,
} from "./truth-tree-closing";
import { treeHelpIntro, treeShortcuts } from "./truth-tree-help";
import {
  editableLines,
  fieldText,
  type MarginDrafts,
  type MarginEdit,
  type MarginTree,
  marginLabel,
  marginMove,
  marginToRight,
  typeCitation,
  typeRule,
  withDrafts,
} from "./truth-tree-margin";

const HISTORY_LIMIT = 200;

/**
 * What a tree as it stands gives: its index, its layout and its check. A
 * document is never changed in place, so these are kept until the element's
 * tree is replaced, not rebuilt at every render, keystroke and row asked
 * about. The layout is kept for the rules it was made with too, since a
 * line's justification is a step's citation and its rule.
 */
interface Derived {
  readonly tree: TableauDocument;
  readonly index: TableauIndex;
  layout: {
    readonly rules: ReadonlyMap<string, string>;
    readonly layout: TableauLayout;
  };
  /**
   * The tree as a derivation, and its rules and instances as they were when
   * it was made.
   */
  proof?: {
    readonly rules: ReadonlyMap<string, string>;
    readonly instances: ReadonlyMap<string, string>;
    readonly directions: ReadonlyMap<string, string>;
    readonly proof: TreeProof;
  };
  /** The report, and the evidence it was made with. */
  report?: {
    readonly evidence: TreeEvidence;
    readonly report: TreeReport | null;
  };
}

interface Snapshot {
  readonly tree: TableauDocument;
  readonly cursor: string | null;
  /** The rule each development names. */
  readonly rules: ReadonlyMap<string, string>;
  /** The steps' unresolved citations and rules, by development. */
  readonly drafts: MarginDrafts;
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
   * compile found, or as the prior answer recorded until one has run. An
   * edit keeps them until the next compile replaces them: a row whose text
   * no longer has its instance in it drops it on its own (`emitTreeProof`
   * states only a row's candidates), and dropping all of them at every
   * keystroke would have every open branch flash incomplete.
   */
  private instances: ReadonlyMap<string, string> = new Map();
  /**
   * The direction each identity on a branch marked open is developed in, by
   * `pairingKey`, as the last compile found it: kept across edits like the
   * instances.
   */
  private directions: ReadonlyMap<string, string> = new Map();
  /**
   * The derivation whose certificate the answer still owes, for the tree and
   * rules it was made from: the last compile found every step right and left
   * the certificate to the submit (see `certify`). Null when none is owed.
   */
  private owed: {
    readonly mm0: string;
    readonly goal: string;
    readonly proof: string;
    readonly tree: TableauDocument;
    readonly rules: ReadonlyMap<string, string>;
    settling: Promise<void> | null;
  } | null = null;
  private drafts: MarginDrafts = { cites: new Map(), rule: new Map() };
  private past: Snapshot[] = [];
  private future: Snapshot[] = [];
  private cursor: string | null = null;
  private editing: string | null = null;
  /**
   * An edit begun on an existing row, whose undo step is recorded at its
   * first keystroke, so that opening a row and leaving it records nothing.
   */
  private editPending = false;
  private marginEdit: MarginEdit | null = null;
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
      intro: treeHelpIntro(resolved.finish, (id) => this.t(id)),
      keyboard: this.t("Keyboard"),
      shortcuts: treeShortcuts(this.offersOpen, (id) => this.t(id)),
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
    // A compile or certificate in flight lands on nothing: its run is
    // superseded, nothing is owed, and with no mount there is no render.
    this.cancelCompile();
    this.owed = null;
    this.listeners.abort();
    if (this.mount !== null) {
      render(null, this.mount);
      this.mount = null;
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

    const freshRows = new Map<string, string>();

    for (const [at, row] of before.entries()) {
      const now = after[at];

      if (now !== undefined) {
        fresh.set(row.dev, now.dev);
        freshRows.set(row.id, now.id);
      }
    }

    this.rules = new Map(
      [...rules].flatMap(([dev, rule]) => {
        const now = fresh.get(dev);
        return now === undefined ? [] : [[now, rule] as const];
      }),
    );
    // And each row's instance to its row, until the first compile says again.
    this.instances = new Map(
      Object.entries((usable ? prior.instances : undefined) ?? {}).flatMap(
        ([row, instance]) => {
          const now = freshRows.get(row);
          return now === undefined ? [] : [[now, instance] as const];
        },
      ),
    );

    // And each identity's direction to its leaf and row: nodes keep their
    // places too.
    const freshNodes = new Map(
      saved.nodes.flatMap((node, at) => {
        const now = this.tree.nodes[at];
        return now === undefined ? [] : [[node.id, now.id] as const];
      }),
    );

    this.directions = new Map(
      Object.entries((usable ? prior.directions : undefined) ?? {}).flatMap(
        ([key, statement]) => {
          const pairing = pairingOf(key);
          const nowLeaf = freshNodes.get(pairing?.leaf ?? "");
          const nowRow = freshRows.get(pairing?.row ?? "");

          return nowLeaf === undefined || nowRow === undefined
            ? []
            : [[pairingKey(nowLeaf, nowRow), statement] as const];
        },
      ),
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
   * The instances and directions, like the certificate, are what the engine
   * made of the tree, not what the student wrote: an answer that gains them
   * when a compile lands is no less saved than it was.
   */
  protected override authoredAnswer(): string {
    const {
      directions: _directions,
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
    // In key order, so that the same rules make the same answer however
    // they were typed: a rule cleared and typed again is no unsaved work.
    const byKey = (
      [a]: readonly [string, string],
      [b]: readonly [string, string],
    ) => (a < b ? -1 : a > b ? 1 : 0);
    const rules = [...this.rules]
      .filter(([dev]) => devs.has(dev))
      .sort(byKey);
    const instances = [...this.instances]
      .filter(([id]) => ids.has(id))
      .sort(byKey);
    const nodes = new Set(this.tree.nodes.map((node) => node.id));
    const directions = [...this.directions]
      .filter(([key]) => {
        const pairing = pairingOf(key);
        return (
          pairing !== null && nodes.has(pairing.leaf) && ids.has(pairing.row)
        );
      })
      .sort(byKey);

    return {
      ...(directions.length === 0
        ? {}
        : { directions: Object.fromEntries(directions) }),
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
        layout: {
          layout: layoutTableau(this.tree, this.rules),
          rules: this.rules,
        },
        tree: this.tree,
      };
    }

    if (this.derived.layout.rules !== this.rules) {
      this.derived.layout = {
        layout: layoutTableau(this.tree, this.rules),
        rules: this.rules,
      };
    }

    return this.derived;
  }

  private get index(): TableauIndex {
    return this.derive().index;
  }

  private get layout(): TableauLayout {
    return this.derive().layout.layout;
  }

  /** The tree as a derivation, made once per tree, rules and instances. */
  private proof(resolved: ResolvedTree): TreeProof {
    const derived = this.derive();

    if (
      derived.proof?.rules !== this.rules ||
      derived.proof.instances !== this.instances ||
      derived.proof.directions !== this.directions
    ) {
      derived.proof = {
        directions: this.directions,
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
   * with, and which way round each identity on a branch marked open is
   * developed: it states every candidate, and a link or pair that fails says
   * only that it was not that one. The instances that hold, and the direction
   * refused least, are kept, and when the derivation stating only those
   * differs from the one asked, it is compiled again for the certificate.
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

    this.owed = null;

    const asking = askingProofOf(resolved, answer);

    // Nothing to state, or a tree past the caps, refused unread: the engine
    // is not asked.
    if (asking.goal === null || asking.proof === null) {
      this.instances = new Map();
      this.directions = new Map();
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
      this.engineFailed(asked.kind);
      this.syncAnswer();
      this.rerender();
      return;
    }

    const read = readAsked(resolved, answer, asking, {
      certified: asked.verdict.certificate !== null,
      diagnostics: asked.verdict.problems,
    });
    this.instances = read.instances;
    this.directions = read.directions;
    // The derivation stating them is made already: `proof` need not again.
    this.derive().proof = {
      directions: this.directions,
      instances: this.instances,
      proof: read.proof,
      rules,
    };

    // Every step held, so the derivation stating only what held certifies
    // too; it differs from the one asked only by the links and directions
    // not chosen. Compiling it costs as much again, and only the
    // certificate needs it, so it is owed until a submit asks for it
    // (`certify`).
    if (read.owed !== null) {
      this.mmb = "";
      this.owed = { ...read.owed, mm0, rules, settling: null, tree };
    }

    this.evidence = {
      certified: read.certified,
      errors: read.errors,
      kind: "compiled",
    };
    this.syncAnswer();
    this.rerender();
  }

  private buildCheck(): void {
    if (this.feedback === "none") {
      return;
    }

    mountActionButton(this, "truth-tree-check", this.t("Check"), () =>
      this.runCheck(),
    );
  }

  /**
   * Compile the certificate the answer owes, for a submit to wait on; null
   * when none is owed, or the tree has changed since it was (the edit's own
   * compile settles first, and owes afresh). The same promise to every gate
   * that asks while it runs.
   */
  protected override certify(): Promise<void> | null {
    const owed = this.owed;

    if (
      owed === null ||
      owed.tree !== this.tree ||
      owed.rules !== this.rules
    ) {
      return null;
    }

    owed.settling ??= (async () => {
      const run = await this.runCompiler(
        `${owed.mm0}\n${owed.goal}\n`,
        owed.proof,
      );

      if (this.owed !== owed) {
        return;
      }

      this.owed = null;

      if (run === null) {
        return;
      }

      // It certifies whenever every step held; should it not, the evidence
      // says so rather than let the submit go on a promise, and the mark
      // takes back its check, so the submit it held is refused, not sent
      // without a certificate.
      if (run.kind !== "verdict") {
        this.engineFailed(run.kind);
      } else if (run.verdict.certificate === null) {
        this.evidence = {
          certified: false,
          errors:
            this.evidence.kind === "compiled" ? this.evidence.errors : [],
          kind: "compiled",
        };
        this.setMark("idle");
      }

      this.syncAnswer();
      this.rerender();
    })();

    return owed.settling;
  }

  /**
   * The engine could not be loaded, or could not read the derivation: it
   * has no word on the tree, and the mark says why, as the proof widgets'
   * does, since without that word the tree can be neither right nor wrong.
   */
  private engineFailed(reason: EngineFailure): void {
    this.evidence = { kind: "failed", reason };
    this.setMark("error", engineFailureText(reason, this.words));
  }

  private async runCheck(): Promise<void> {
    const resolved = this.resolved;

    if (resolved === null) {
      return;
    }

    // The engine's word on the tree as it stands, first.
    await this.settled();

    const judgement = this.judgement(resolved);
    const status = describeJudgement(
      judgement,
      this.tree,
      this.rules,
      this.words,
      this.showsDetail,
    );

    this.setCheckStatus(status, judgement.ok);

    if (judgement.problem?.type === "engine-failed") {
      this.setMark("error", status);
    } else {
      this.setMark(judgement.ok ? "ok" : "idle");
    }
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
    this.setMark("idle");
    this.syncAnswer();
    this.scheduleCompile();
    this.rerender();
  }

  private number(rowId: string, layout = this.layout): string {
    return layoutNumbers(layout)(rowId);
  }

  private isRootRow(rowId: string): boolean {
    return isRootRow(this.index, rowId, this.resolved?.root.length ?? 0);
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
      const head = marginToRight(this.marginTree, this.cursor);

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
      this.marginEdit === null
    );
  }

  /** The tree as the margin reads it, at the current layout. */
  private get marginTree(): MarginTree {
    const layout = this.layout;

    return {
      index: this.index,
      isRootRow: (rowId) => this.isRootRow(rowId),
      layout,
      number: layoutNumbers(layout),
    };
  }

  /**
   * A key with the selection on a margin field: → goes on from the citation
   * to the rule, ← back to the citation and from it to the line's rows, ↑
   * and ↓ to the same field of the lines above and below, Enter types it (or
   * c the citation, j the rule), and Delete clears it (the row stays).
   * `false` for any other action, which leaves the margin for its row.
   */
  private marginAct(action: TableauKeyAction): boolean {
    const cursor = this.cursor;

    if (cursor === null || !this.layout.rows.has(cursor)) {
      return false;
    }

    const moved = marginMove(
      this.marginTree,
      { cursor, field: this.marginField, marginOf: this.marginOf },
      action,
    );

    if (moved !== null) {
      this.cursor = moved.cursor;
      this.marginOf = moved.marginOf;
      this.marginField = moved.field;
      return true;
    }

    switch (action) {
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
          { draft: "", field: this.marginField, row: cursor },
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
    this.marginEdit = null;
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
    this.marginEdit = {
      draft: this.fieldText(head, field),
      field,
      row: head,
    };
    this.rerender();
  }

  /** A field of a row's margin as it shows. */
  private fieldText(rowId: string, field: MarginField): string {
    return fieldText(this.marginTree, this.drafts, this.rules, rowId, field);
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
    this.marginEdit = null;
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
   * Mark a row the branch closes on, or unmark it, from its circle. The mark
   * that completes a closure closes the branch on the rows marked, in the
   * order they were marked.
   */
  private pick(rowId: string): void {
    const closing = this.closing;

    if (
      closing === null ||
      !this.index.branchRows(closing.leaf).some((each) => each.id === rowId)
    ) {
      return;
    }

    const resolved = this.resolved;
    const row = this.number(rowId);
    const picked = pick(
      closing,
      rowId,
      (resolved === null
        ? undefined
        : closureArities(resolved.development).at(-1)) ?? 2,
      (rows) =>
        resolved !== null &&
        closesBranch(
          resolved.development,
          resolved.reader,
          rows.map((each) => this.index.row(each)?.row.text ?? ""),
        ),
    );

    this.cursor = rowId;
    this.focusTree = true;

    if (picked.type !== "closed") {
      this.closing = picked.closing;
      this.announce(
        picked.type === "marked"
          ? this.t("Row {row} marked.", { row })
          : this.t("Row {row} unmarked.", { row }),
      );
      this.rerender();
      return;
    }

    this.closing = null;
    this.commit(
      setEnd(this.tree, closing.leaf, {
        cites: picked.cites,
        type: "closed",
      }),
      closedOn(
        picked.cites.map((each) => this.number(each)),
        (id, values) => this.t(id, values),
      ),
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
    this.marginEdit = null;
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

  private readonly onMarginText = (text: string): void => {
    if (this.marginEdit !== null) {
      this.marginEdit = { ...this.marginEdit, draft: text };
      this.rerender();
    }
  };

  private readonly onMarginTextKey = (event: KeyboardEvent): void => {
    const edit = this.marginEdit;

    if (edit === null) {
      return;
    }

    // Enter and Esc alike keep what was typed and go back to the row. Tab
    // goes on from the citation to the rule, and Shift-Tab back, as in the
    // book's margin; Tab from the rule leaves as it would anywhere, and the
    // blur keeps what was typed too.
    if (event.key === "Enter" || event.key === "Escape") {
      event.preventDefault();
      this.commitMargin(edit, true);
      return;
    }

    const next =
      event.key !== "Tab"
        ? null
        : !event.shiftKey && edit.field === "cites"
          ? "rule"
          : event.shiftKey && edit.field === "rule"
            ? "cites"
            : null;

    if (next !== null) {
      event.preventDefault();
      this.commitMargin(edit, true);
      this.cursor = edit.row;
      this.focusTree = true;
      this.startMargin(next);
    }
  };

  /**
   * Focus left a margin field: keep what was typed. Taken away as if by Esc,
   * focus goes back to the row as after Esc. A blur from the field just left
   * for the other one (Tab) is not this field's.
   */
  private readonly onMarginTextBlur = (event: FocusEvent): void => {
    const edit = this.marginEdit;
    const input =
      edit?.field === "rule" ? "tableau-rule-input" : "tableau-cite-input";

    if (
      edit !== null &&
      document.hasFocus() &&
      (event.target as Element | null)?.classList.contains(input) !== false
    ) {
      this.commitMargin(edit, this.strayBlur(event));
    }
  };

  /** Keep what was typed in a margin field. */
  private commitMargin(edit: MarginEdit, refocus: boolean): void {
    if (edit.field === "rule") {
      this.commitRule(edit, refocus);
    } else {
      this.commitCite(edit, refocus);
    }
  }

  /**
   * Keep the typed rule for the step (`typeRule`). `refocus` as for
   * {@link commitCite}.
   */
  private commitRule(edit: MarginEdit, refocus: boolean): void {
    const location = this.index.row(edit.row);
    const text = edit.draft.trim();
    const language = this.resolved?.language;

    this.marginEdit = null;
    this.focusTree = refocus;

    if (
      location === null ||
      language === undefined ||
      text === this.fieldText(edit.row, "rule")
    ) {
      this.rerender();
      return;
    }

    const typed = typeRule(
      language,
      this.rules,
      this.drafts,
      location.row.dev,
      this.number(edit.row),
      text,
      (id, values) => this.t(id, values),
    );

    this.remember();
    this.rules = typed.rules;
    this.drafts = { ...this.drafts, rule: typed.drafts };
    this.announce(typed.announcement);
    this.edited();
  }

  /**
   * Keep the typed citation for every row of the step (`typeCitation`).
   * `refocus` hands focus back to the row: not when focus has already gone
   * elsewhere.
   */
  private commitCite(edit: MarginEdit, refocus: boolean): void {
    const text = edit.draft.trim();

    this.marginEdit = null;
    this.focusTree = refocus;

    const typed =
      text === this.fieldText(edit.row, "cites")
        ? null
        : typeCitation(
            this.marginTree,
            this.drafts,
            edit.row,
            text,
            (id, values) => this.t(id, values),
          );

    if (typed === null) {
      this.rerender();
      return;
    }

    this.remember();
    this.tree = setRowCites(this.tree, typed.step, typed.cites);
    this.drafts = { ...this.drafts, cites: typed.drafts };
    this.announce(typed.announcement);
    this.edited();
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

    const target = circleMove(
      this.index.branchRows(closing.leaf).map((each) => each.id),
      rowId,
      event.key,
    );

    if (target !== undefined) {
      event.preventDefault();
      this.cursor = target;
      this.focusTree = true;
      this.rerender();
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

    const language = this.resolved?.language;
    const name = (engine: string): string =>
      language === undefined ? engine : displayName(engine, language);

    for (const [nodeId, problem] of report.ends) {
      notes.set(
        nodeId,
        describeEndProblem(problem, this.words, number, name),
      );
    }

    return notes;
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
    const number = layoutNumbers(layout);
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
        : atBranchEnd(endNote, last.id, this.words, number);
    }

    const rowNote = notes.get(location.row.id);

    if (rowNote !== undefined) {
      return atRow(rowNote, location.row.id, this.words, number);
    }

    const endNote = notes.get(location.node.id);
    const last = location.node.rows[location.node.rows.length - 1];

    return endNote === undefined || last === undefined
      ? null
      : atBranchEnd(endNote, last.id, this.words, number);
  }

  private view(
    resolved: ResolvedTree,
    report: TreeReport | null,
    layout: TableauLayout,
  ) {
    const annotations =
      report === null
        ? null
        : withDrafts(
            treeAnnotations(
              this.tree,
              layout,
              report,
              resolved.language,
              this.words,
              {
                flag: this.showsDetail,
                marks: this.showsDetail,
                rootRows: resolved.root.length,
                rules: this.rules,
              },
            ),
            this.marginTree,
            this.drafts,
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
            editableMargins={editableLines(this.marginTree)}
            marginEdit={this.marginEdit}
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
            onMarginText={this.onMarginText}
            onMarginTextBlur={this.onMarginTextBlur}
            onMarginTextKey={this.onMarginTextKey}
            onCursor={this.onRowClick}
            marginStop={
              this.onMarginStop() && this.cursor !== null
                ? {
                    field: this.marginField,
                    label: marginLabel(
                      this.marginTree,
                      this.drafts,
                      this.rules,
                      this.cursor,
                      this.marginField,
                      (id, values) => this.t(id, values),
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
