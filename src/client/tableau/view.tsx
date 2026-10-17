/** @jsxImportSource preact */
/**
 * The tableau, live: the same grid `src/tableau/html.ts` draws on the server,
 * as a Preact view with a cursor, a roving tab stop and inline editing.
 *
 * It knows no logic. What a row means, what a key does and what is wrong
 * with anything are the consumer's; the view draws the document at the
 * layout, shows the annotations and notes it is handed, and reports what
 * the reader does through its callbacks.
 *
 * Accessibility: the grid is an ARIA tree whose items are the rows and the
 * branch end marks, in tree order, each with its level (how many nodes deep)
 * and its description in words. Numbers, margins and connectors are drawn
 * for the eye and hidden; a row's description says what they say.
 */

import type { JSX } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import type { TableauDocument, TableauEnd } from "../../tableau/document";
import { TableauIndex } from "../../tableau/document";
import type { MarginField, TableauAnnotations } from "../../tableau/html";
import {
  contentRow,
  END_SYMBOLS,
  forkPath,
  gridColumns,
  gridTemplate,
  guideRows,
} from "../../tableau/html";
import type { PlacedRow, TableauLayout } from "../../tableau/layout";

export interface TableauViewProps {
  readonly document: TableauDocument;
  readonly layout: TableauLayout;
  readonly annotations: TableauAnnotations;
  /** The tree's accessible name. */
  readonly label: string;
  /** A row's id, or the id of a node whose end mark the cursor is on. */
  readonly cursor: string | null;
  /** The row whose text is being typed. */
  readonly editing: string | null;
  /**
   * The row whose margin is being typed in, which of its fields, and the
   * draft.
   */
  readonly marginEdit: {
    readonly row: string;
    readonly draft: string;
    readonly field: MarginField;
  } | null;
  /** Labels for the inputs, which have no visible label of their own. */
  readonly inputLabels: {
    readonly text: string;
    readonly cites: string;
    readonly rule: string;
  };
  /** Something to say about a row or a branch end: a problem, say. */
  readonly notes?: ReadonlyMap<string, string>;
  /**
   * The lines whose margin the reader may click to type a citation or a
   * rule. Such a line shows an empty slot for each field with nothing in it.
   */
  readonly editableMargins?: ReadonlySet<number>;
  /**
   * Rows being marked, as a branch's closing rows are: those that may be
   * marked, those that are, and each one's control's name. Each markable row
   * gets a round checkbox in the gutter beside its number, as a truth table's
   * counterexample rows get their radios, and the checkboxes are then the
   * only thing that takes focus: the rows and end marks leave the tab order
   * until marking is over. The cursor's row's checkbox is the one tab stop;
   * the consumer reads the keys that move it.
   */
  readonly picking?:
    | {
        readonly among: ReadonlySet<string>;
        readonly picked: ReadonlySet<string>;
        readonly label: (rowId: string) => string;
        readonly onPick: (rowId: string) => void;
        readonly onKey: (event: KeyboardEvent, rowId: string) => void;
      }
    | undefined;
  /**
   * The selection is on a field of a line's margin, not a row: that margin is
   * the tree's one tab stop, a tree item named `label`. Its keys go to
   * `onMarginKey`.
   */
  readonly marginStop?:
    | {
        readonly line: number;
        readonly label: string;
        readonly field: MarginField;
      }
    | undefined;
  readonly onMarginKey?: (event: KeyboardEvent, line: number) => void;
  /** Move focus to the cursor, or to the input being typed in, after render. */
  readonly focus: boolean;
  /** The reader clicked a row, or an end mark (named by its node's id). */
  readonly onCursor: (itemId: string) => void;
  /** The reader clicked a field of an editable line's margin. */
  readonly onMargin?: (line: number, field: MarginField) => void;
  /** A key on a row, or on an end mark (named by its node's id). */
  readonly onRowKey: (event: KeyboardEvent, itemId: string) => void;
  readonly onText: (rowId: string, text: string) => void;
  readonly onTextKey: (event: KeyboardEvent, rowId: string) => void;
  /** Focus left the row's text input: the reader is done typing. */
  readonly onTextBlur: (rowId: string, event: FocusEvent) => void;
  /** Typing in a margin field, whichever `marginEdit` says. */
  readonly onMarginText: (text: string) => void;
  readonly onMarginTextKey: (event: KeyboardEvent) => void;
  /** Focus left the margin field's input. */
  readonly onMarginTextBlur: (event: FocusEvent) => void;
}

/** A stable id for a row's note, inside the shadow root. */
function noteId(id: string): string {
  return `tableau-note-${id}`;
}

export function TableauView(props: TableauViewProps) {
  const { annotations, document, layout } = props;
  const grid = useRef<HTMLDivElement>(null);
  const index = new TableauIndex(document);
  const flagged = annotations.flagged ?? new Set<string>();

  useLayoutEffect(() => {
    if (!props.focus || grid.current === null) {
      return;
    }

    const target =
      grid.current.querySelector<HTMLElement>("[data-focus-input]") ??
      grid.current.querySelector<HTMLElement>("[data-margin-stop]") ??
      [...grid.current.querySelectorAll<HTMLElement>("[data-item]")].find(
        (item) => item.dataset.item === props.cursor,
      );

    target?.focus();
  });

  const cells: JSX.Element[] = [];

  for (const [line, ids] of layout.lineRows) {
    const row = contentRow(line);
    const picking = props.picking;
    const pickable =
      picking === undefined
        ? undefined
        : ids.find((id) => picking.among.has(id));

    cells.push(
      <span
        class="tableau-number"
        key={`n${line}`}
        style={{ gridColumn: "1", gridRow: String(row) }}
      >
        <span aria-hidden="true">{line}</span>
        {picking === undefined || pickable === undefined ? null : (
          <input
            aria-label={picking.label(pickable)}
            checked={picking.picked.has(pickable)}
            class="tableau-pick"
            data-focus-input={pickable === props.cursor ? "" : undefined}
            onChange={() => picking.onPick(pickable)}
            onKeyDown={(event) => picking.onKey(event, pickable)}
            tabIndex={pickable === props.cursor ? 0 : -1}
            type="checkbox"
          />
        )}
      </span>,
    );

    const marginEdit =
      props.marginEdit !== null &&
      layout.rows.get(props.marginEdit.row)?.line === line
        ? props.marginEdit
        : null;
    const note = annotations.margins?.get(line);
    const editable = props.editableMargins?.has(line) === true;
    const stop =
      props.marginStop?.line === line ? props.marginStop : undefined;
    const flags = annotations.flaggedMargins ?? {};
    const field = (name: MarginField): JSX.Element | null => {
      if (marginEdit?.field === name) {
        return (
          <input
            aria-label={
              name === "cites"
                ? props.inputLabels.cites
                : props.inputLabels.rule
            }
            autocomplete="off"
            class={`tableau-${name === "cites" ? "cite" : "rule"}-input`}
            data-empty={marginEdit.draft === "" ? "" : undefined}
            data-focus-input=""
            inputMode={name === "cites" ? "numeric" : undefined}
            key={name}
            onBlur={(event) => props.onMarginTextBlur(event)}
            onInput={(event) => props.onMarginText(event.currentTarget.value)}
            onKeyDown={(event) => props.onMarginTextKey(event)}
            spellcheck={false}
            type="text"
            value={marginEdit.draft}
          />
        );
      }

      const text = note?.[name] ?? "";

      if (text === "" && !editable) {
        return null;
      }

      // A mouse's way to the field, which the keyboard reaches through the
      // margin stop; hidden, as the margin is, since the row's description
      // and the stop's name say it.
      return (
        <span
          aria-hidden="true"
          class={`tableau-margin-${name}`}
          data-flagged={flags[name]?.has(line) === true ? "" : undefined}
          data-selected={stop?.field === name ? "" : undefined}
          key={name}
          onClick={
            editable
              ? (event) => {
                  event.stopPropagation();
                  props.onMargin?.(line, name);
                }
              : undefined
          }
        >
          {text === "" ? <span class="tableau-margin-slot" /> : text}
        </span>
      );
    };
    const fields = [field("cites"), field("rule")].filter(
      (each) => each !== null,
    );
    const content = fields.flatMap((each, at) =>
      at === 0 ? [each] : [" ", each],
    );
    const place = {
      gridColumn: String(layout.columns + 2),
      gridRow: String(row),
    };

    if (marginEdit !== null) {
      cells.push(
        <span
          class="tableau-margin tableau-margin-editing"
          key={`m${line}`}
          style={place}
        >
          {content}
        </span>,
      );
    } else if (stop !== undefined) {
      // The selection is here: the margin is the item the keys work on, and
      // the field it is on is marked.
      const node = ids[0] === undefined ? null : index.row(ids[0]);

      cells.push(
        <span
          aria-label={stop.label}
          aria-level={
            node === null ? undefined : index.path(node.node.id).length
          }
          aria-selected="true"
          class="tableau-margin"
          data-editable={editable ? "" : undefined}
          data-cursor=""
          data-margin-stop=""
          key={`m${line}`}
          onKeyDown={(event) => props.onMarginKey?.(event, line)}
          role="treeitem"
          style={place}
          tabIndex={0}
        >
          <span aria-hidden="true">{content}</span>
        </span>,
      );
    } else if (fields.length > 0) {
      // A mouse's way to the citation and rule, which the keyboard reaches
      // from the row; hidden, as the margin is, since the row's description
      // says it.
      cells.push(
        <span
          aria-hidden="true"
          class="tableau-margin"
          data-editable={editable ? "" : undefined}
          key={`m${line}`}
          style={place}
        >
          {content}
        </span>,
      );
    }
  }

  for (const fork of layout.forks) {
    cells.push(
      <svg
        aria-hidden="true"
        class="tableau-fork"
        focusable="false"
        key={`f${fork.node}`}
        preserveAspectRatio="none"
        style={{
          gridColumn: gridColumns(fork.span),
          gridRow: String(contentRow(fork.line) - 1),
        }}
        viewBox="0 0 100 10"
      >
        <path d={forkPath(fork.span, fork.children)} />
      </svg>,
    );
  }

  for (const [at, guide] of layout.guides.entries()) {
    cells.push(
      <span
        aria-hidden="true"
        class="tableau-guide"
        data-from-fork={guide.fromFork ? "" : undefined}
        key={`g${at}`}
        style={{
          gridColumn: gridColumns(guide.span),
          gridRow: guideRows(guide),
        }}
      />,
    );
  }

  // The rows and end marks last and in tree order, so the tree's items read
  // top to bottom, branch by branch, whatever line each sits on.
  for (const node of index.preorder()) {
    const level = index.path(node.id).length;

    for (const each of node.rows) {
      const placed = layout.rows.get(each.id);

      if (placed === undefined) {
        continue;
      }

      const mark = annotations.marks?.get(each.id);
      const note = props.notes?.get(each.id);
      const label = annotations.describeRow(each.id);
      const selected =
        props.cursor === each.id && props.marginStop === undefined;
      const editing = props.editing === each.id;
      const picked = props.picking?.picked.has(each.id) === true;

      cells.push(
        <div
          aria-describedby={note === undefined ? undefined : noteId(each.id)}
          aria-label={label}
          aria-level={level}
          aria-selected={selected ? "true" : "false"}
          class="tableau-row"
          data-cursor={selected ? "" : undefined}
          data-flagged={flagged.has(each.id) && !editing ? "" : undefined}
          data-picked={picked ? "" : undefined}
          data-item={each.id}
          data-row={each.id}
          key={each.id}
          onClick={(event) => {
            // A click inside the row's own input is typing, not a move.
            if ((event.target as HTMLElement).tagName !== "INPUT") {
              props.onCursor(each.id);
            }
          }}
          onKeyDown={(event) => {
            if (event.target === event.currentTarget) {
              props.onRowKey(event, each.id);
            }
          }}
          role="treeitem"
          style={{
            gridColumn: gridColumns(placed.span),
            gridRow: String(contentRow(placed.line)),
          }}
          tabIndex={
            props.picking !== undefined ? undefined : selected ? 0 : -1
          }
          data-problem={note}
        >
          {editing ? (
            <input
              aria-label={props.inputLabels.text}
              autocomplete="off"
              class="tableau-input"
              data-empty={each.text === "" ? "" : undefined}
              data-focus-input=""
              onBlur={(event) => props.onTextBlur(each.id, event)}
              onInput={(event) =>
                props.onText(each.id, event.currentTarget.value)
              }
              onKeyDown={(event) => props.onTextKey(event, each.id)}
              spellcheck={false}
              // As wide as its text and a place for the caret: it grows as
              // it is typed in, as the proof tree's field does.
              style={{ width: `${Math.max(2.6, each.text.length + 1)}ch` }}
              type="text"
              value={each.text}
            />
          ) : (
            <span aria-hidden="true" class="tableau-text">
              {each.text}
            </span>
          )}
          {mark === undefined || editing ? null : (
            <span aria-hidden="true" class="tableau-mark">
              {mark}
            </span>
          )}
          {note === undefined ? null : (
            <span class="visually-hidden" id={noteId(each.id)}>
              {note}
            </span>
          )}
        </div>,
      );
    }

    const placedEnd = layout.ends.get(node.id);

    if (node.end !== undefined && placedEnd !== undefined) {
      cells.push(
        endItem(props, node.id, node.end, placedEnd, level, flagged),
      );
    }
  }

  return (
    <div class="tableau-scroller">
      <div
        aria-label={props.label}
        class="tableau-grid"
        onMouseDown={
          props.picking === undefined
            ? undefined
            : (event) => {
                // While marking, a press anywhere in the tree but a circle
                // leaves focus on the circle it was on, not on the page.
                if (!(event.target as HTMLElement).matches(".tableau-pick")) {
                  event.preventDefault();
                }
              }
        }
        ref={grid}
        role="tree"
        style={{
          // Wider while marking, for the checkboxes beside the numbers.
          gridTemplateColumns: gridTemplate(
            layout.columns,
            props.picking === undefined ? undefined : "3.8rem",
          ),
        }}
      >
        {cells}
      </div>
    </div>
  );
}

/** A branch's end mark: a tree item of its own, which the cursor can rest on. */
function endItem(
  props: TableauViewProps,
  nodeId: string,
  end: TableauEnd,
  placed: PlacedRow,
  level: number,
  flagged: ReadonlySet<string>,
) {
  const note = props.notes?.get(nodeId);
  const cites = props.annotations.endNotes?.get(nodeId);
  const selected = props.cursor === nodeId;

  return (
    <div
      aria-describedby={note === undefined ? undefined : noteId(nodeId)}
      aria-label={props.annotations.describeEnd(nodeId)}
      aria-level={level}
      aria-selected={selected ? "true" : "false"}
      class="tableau-end"
      data-cursor={selected ? "" : undefined}
      data-end={end.type}
      data-flagged={flagged.has(nodeId) ? "" : undefined}
      data-item={nodeId}
      key={`e${nodeId}`}
      onClick={() => props.onCursor(nodeId)}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget) {
          props.onRowKey(event, nodeId);
        }
      }}
      role="treeitem"
      style={{
        gridColumn: gridColumns(placed.span),
        gridRow: String(contentRow(placed.line)),
      }}
      tabIndex={props.picking !== undefined ? undefined : selected ? 0 : -1}
      data-problem={note}
    >
      <span aria-hidden="true" class="tableau-end-mark">
        {END_SYMBOLS[end.type]}
      </span>
      {cites === undefined ? null : (
        <span aria-hidden="true" class="tableau-end-note">
          {cites}
        </span>
      )}
      {note === undefined ? null : (
        <span class="visually-hidden" id={noteId(nodeId)}>
          {note}
        </span>
      )}
    </div>
  );
}
