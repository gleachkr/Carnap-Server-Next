/**
 * The forallx: Calgary natural-deduction theory, as the tests see it.
 *
 * The theory itself ships at `src/worker/logic/theories/forallx-calgary-2019.mm0`
 * and is served at `/theories/forallx-calgary-2019.mm0`; its header is where the
 * rule→axiom table, the eigenvariable discussion, and the warning about
 * dependency lists now live. This module is a re-export so that the demo
 * lessons and `scripts/{forallx,prawitz,showcase}-verify.ts` exercise the text
 * an author actually gets, and cannot drift from it.
 */

import { THEORY_SOURCES } from "../../src/worker/logic/theories";

const source = THEORY_SOURCES["forallx-calgary-2019.mm0"];

if (source === undefined) {
  throw new Error("the forallx-calgary-2019 theory is no longer registered");
}

export const FORALLX_THEORY_MM0 = source;

/** The `:::aufbau-mm0{name="forallx"}` block wrapping {@link FORALLX_THEORY_MM0}. */
export const FORALLX_THEORY_BLOCK = `:::aufbau-mm0{name="forallx"}\n${FORALLX_THEORY_MM0}\n:::`;
