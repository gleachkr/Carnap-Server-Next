/**
 * Moving a cursor around a tableau, and the keys that do it.
 *
 * The cursor is on a row, or on a branch's end mark, which is named by its
 * node's id. Up and down follow the branch; down at a split takes the
 * leftmost branch, and the end mark is the last stop below a branch's rows.
 * Left and right go to the nearest row or end mark in the neighbouring
 * columns, on the same line where there is one. The keys are
 * named as actions, so an editor maps a key to what it means here and decides
 * for itself what `stack` or `close` does.
 */

import type { TableauIndex, TableauNode } from "./document";
import type { TableauLayout } from "./layout";

export type Direction = "up" | "down" | "left" | "right";

export function moveCursor(
  index: TableauIndex,
  layout: TableauLayout,
  itemId: string,
  direction: Direction,
): string | null {
  const end = layout.ends.get(itemId);
  const location = index.row(itemId);
  const placed = end ?? layout.rows.get(itemId);

  if ((end === undefined && location === null) || placed === undefined) {
    return null;
  }

  if (direction === "up") {
    const above =
      location === null ? index.branchRows(itemId) : index.rowsAbove(itemId);
    return above[above.length - 1]?.id ?? null;
  }

  if (direction === "down") {
    if (location === null) {
      return null;
    }

    const next = location.node.rows[location.index + 1];

    if (next !== undefined) {
      return next.id;
    }

    // The branch's end mark, or the first row below, through any empty
    // nodes, down the leftmost path.
    let node: TableauNode | undefined = location.node;

    while (node !== undefined) {
      if (node !== location.node && node.rows[0] !== undefined) {
        return node.rows[0].id;
      }

      if (layout.ends.has(node.id)) {
        return node.id;
      }

      node = index.children(node.id)[0];
    }

    return null;
  }

  let best: { id: string; column: number; line: number } | null = null;

  for (const [id, other] of [...layout.rows, ...layout.ends]) {
    const column =
      direction === "left"
        ? placed.span.start - other.span.end
        : other.span.start - placed.span.end;

    if (column < 0) {
      continue;
    }

    const line = Math.abs(other.line - placed.line);

    if (
      best === null ||
      column < best.column ||
      (column === best.column && line < best.line)
    ) {
      best = { column, id, line };
    }
  }

  return best?.id ?? null;
}

/** What a key asks a tableau editor to do. */
export type TableauKeyAction =
  | Direction
  | "first"
  | "last"
  | "edit"
  | "cite"
  | "rule"
  | "stack"
  | "split"
  | "add-row"
  | "close"
  | "open"
  | "delete"
  | "undo"
  | "redo";

/** The subset of a keyboard event a key map reads. */
export interface KeyPress {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  /**
   * The physical key, which Alt-C and Alt-J match: on a Mac, Option-C's key
   * is ç.
   */
  readonly code?: string;
}

const PLAIN: Readonly<Record<string, TableauKeyAction>> = {
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  Backspace: "delete",
  Delete: "delete",
  End: "last",
  Enter: "edit",
  F2: "edit",
  Home: "first",
  c: "cite",
  j: "rule",
  o: "open",
  r: "add-row",
  s: "split",
  t: "stack",
  x: "close",
};

/** The action a key press on a row asks for, or `null` for none. */
export function keyAction(press: KeyPress): TableauKeyAction | null {
  const command = press.ctrlKey || press.metaKey;

  if (command && !press.altKey) {
    const key = press.key.toLowerCase();

    if (key === "z") {
      return press.shiftKey ? "redo" : "undo";
    }

    return key === "y" ? "redo" : null;
  }

  // Alt-C cites, and Alt-J names the rule, from inside a row's input too,
  // where a plain c or j is typing. Tab is left alone, to leave the tree as
  // it leaves anything.
  //
  // The letter the layout types decides, so Alt-J is J on Dvorak too, where
  // J is the key QWERTY calls C. The physical key stands in only where Alt
  // types no plain letter, as on a Mac, where Alt-C types ç.
  if (press.altKey && !command && !press.shiftKey) {
    const typed = press.key.toLowerCase();
    const key = /^[a-z]$/u.test(typed)
      ? typed
      : press.code === "KeyC"
        ? "c"
        : press.code === "KeyJ"
          ? "j"
          : null;

    return key === "c" ? "cite" : key === "j" ? "rule" : null;
  }

  if (press.altKey || command) {
    return null;
  }

  return PLAIN[press.key] ?? null;
}
