/**
 * The Gentzen (classical LK) sequent calculus, as the tests see it.
 *
 * The theory itself ships at `src/worker/logic/theories/gentzen-lk.mm0` and is
 * served at `/theories/gentzen-lk.mm0`; its header records the provenance (taken
 * verbatim from gleachkr/Aufbau's `tests/proof_cases/gentzen.mm0`) and the
 * structural conventions. This module is a re-export so that the demo lessons
 * and `scripts/gentzen-verify.ts` exercise the text an author actually gets, and
 * cannot drift from it.
 */

import { THEORY_SOURCES } from "../../src/worker/logic/theories";

const source = THEORY_SOURCES["gentzen-lk.mm0"];

if (source === undefined) {
  throw new Error("the gentzen-lk theory is no longer registered");
}

export const GENTZEN_THEORY_MM0 = source;
