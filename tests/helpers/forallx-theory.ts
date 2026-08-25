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

import { stripSyntaxAnnotations } from "@aufbau/syntax";
import { THEORY_SOURCES } from "../../src/worker/logic/theories";

const source = THEORY_SOURCES["forallx-calgary-2019.mm0"];

if (source === undefined) {
  throw new Error("the forallx-calgary-2019 theory is no longer registered");
}

/** The artifact as it is served and as an author reads it, `@syntax` and all. */
export const FORALLX_THEORY_SOURCE = source;

/**
 * The same theory as the *engine* sees it.
 *
 * This file is also forallx: Calgary's language, so it carries `@syntax`
 * annotations, and the engine rejects an annotation that is not its own. The
 * authoring compiler strips them where it freezes a theory into
 * `publicData.mm0`; anything handing the text straight to the compiler — the
 * verify scripts, and the tests that mirror them — has to do the same, which
 * is what this constant is for.
 */
export const FORALLX_THEORY_MM0 = stripSyntaxAnnotations(source);

/** The `:::aufbau-mm0{name="forallx"}` block wrapping the artifact as authored. */
export const FORALLX_THEORY_BLOCK = `:::aufbau-mm0{name="forallx"}\n${FORALLX_THEORY_SOURCE}\n:::`;
