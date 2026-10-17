/**
 * What a binary connective's parts must be for the whole to take a value —
 * the fact about a truth function that the world's evaluation game is built
 * from.
 *
 * The game offers the student a set of part values that forces their claim,
 * and the computer challenges one entry of it.
 *
 * DOM-free and free of i18n, like the rest of the kit's formula code.
 */

import type { BinaryConnective } from "../../logic/specs/connectives";
import { applyBinaryConnective } from "../../logic/specs/connectives";

/**
 * A value for each of a binary connective's two parts, or `null` for a part
 * the set leaves open: `[true, null]` is "the left part is true".
 */
export type PartValues = readonly [boolean | null, boolean | null];

const VALUES = [true, false] as const;

/** Whether every way of filling the open parts gives the connective `value`. */
function forces(
  connective: BinaryConnective,
  values: PartValues,
  value: boolean,
): boolean {
  const lefts = values[0] === null ? VALUES : [values[0]];
  const rights = values[1] === null ? VALUES : [values[1]];

  return lefts.every((left) =>
    rights.every(
      (right) => applyBinaryConnective(connective, left, right) === value,
    ),
  );
}

/**
 * The smallest sets of part values that force a connective to `value`: a
 * single part where one settles it, and both parts only where neither alone
 * does. Empty when nothing gives the value, and `null` when anything does,
 * which are the two cases a connective's own value decides.
 *
 * The order is left before right and true before false. The game offers the
 * sets in this order, and a tree's branches are read in it.
 */
export function forcingSets(
  connective: BinaryConnective,
  value: boolean,
): readonly PartValues[] | null {
  if (forces(connective, [null, null], value)) {
    return null;
  }

  const sets: PartValues[] = [];

  for (const left of VALUES) {
    if (forces(connective, [left, null], value)) {
      sets.push([left, null]);
    }
  }

  for (const right of VALUES) {
    if (forces(connective, [null, right], value)) {
      sets.push([null, right]);
    }
  }

  for (const left of VALUES) {
    for (const right of VALUES) {
      if (
        applyBinaryConnective(connective, left, right) === value &&
        !forces(connective, [left, null], value) &&
        !forces(connective, [null, right], value)
      ) {
        sets.push([left, right]);
      }
    }
  }

  return sets;
}
