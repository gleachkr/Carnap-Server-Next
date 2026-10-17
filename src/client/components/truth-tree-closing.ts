/**
 * The truth-tree editor's closing mode: the rows a branch closes on, marked
 * one by one with a circle beside each row's number, as a truth table's
 * counterexample row is marked.
 *
 * What a mark or a key does is here, as functions of the marks so far; the
 * element keeps the state and applies what these return. DOM-free.
 */

import type { TruthTreeStringId } from "../../worker/exercises/truth-tree/strings";

/** A branch being closed: its leaf, and the rows marked so far, in order. */
export interface Closing {
  readonly leaf: string;
  readonly picked: readonly string[];
}

/** What a mark on a row's circle does. */
export type Picked =
  /** The row was marked, and is not now. */
  | { readonly type: "unmarked"; readonly closing: Closing }
  /** The row is marked, and the branch still open. */
  | { readonly type: "marked"; readonly closing: Closing }
  /** The marks close the branch, on these rows. */
  | { readonly type: "closed"; readonly cites: readonly string[] };

/**
 * A mark on `rowId`'s circle. The marks close the branch once `closes` says
 * a closure rule closes it on them, or once there are as many as `widest`,
 * the most any closure rule cites, right or not: the engine says whether
 * they close it.
 */
export function pick(
  closing: Closing,
  rowId: string,
  widest: number,
  closes: (rows: readonly string[]) => boolean,
): Picked {
  if (closing.picked.includes(rowId)) {
    return {
      closing: {
        ...closing,
        picked: closing.picked.filter((each) => each !== rowId),
      },
      type: "unmarked",
    };
  }

  const picked = [...closing.picked, rowId];

  return closes(picked) || picked.length >= widest
    ? { cites: picked, type: "closed" }
    : { closing: { ...closing, picked }, type: "marked" };
}

/**
 * The row a key on a closing circle moves to, of the branch's `rows`: up and
 * down (Home and End) move between them. Undefined for any other key.
 */
export function circleMove(
  rows: readonly string[],
  rowId: string,
  key: string,
): string | undefined {
  const at = rows.indexOf(rowId);
  const moves: Readonly<Record<string, number>> = {
    ArrowDown: at + 1,
    ArrowUp: at - 1,
    End: rows.length - 1,
    Home: 0,
  };
  const to = moves[key];

  return to === undefined
    ? undefined
    : rows[Math.max(0, Math.min(rows.length - 1, to))];
}

/** What a branch closed on rows numbered `numbers` is announced as. */
export function closedOn(
  numbers: readonly string[],
  t: (
    id: TruthTreeStringId,
    values?: Readonly<Record<string, string>>,
  ) => string,
): string {
  const [first = "?", second = "?"] = numbers;

  switch (numbers.length) {
    case 1:
      return t("Branch closed on row {row}", { row: first });
    case 2:
      return t("Branch closed on rows {first} and {second}", {
        first,
        second,
      });
    default:
      return t("Branch closed on rows {rows}", { rows: numbers.join(", ") });
  }
}
