import { describe, expect, test } from "bun:test";
import { stripSyntaxAnnotations } from "@aufbau/syntax";
import { THEORY_SOURCES } from "../src/worker/logic/theories";
import { engine } from "./helpers/engine";

/**
 * `≠` in forallx: Calgary is a def over `¬ =`, which matching sees through
 * and the engine's normalization does not: it reads `¬ (x = a)` as the def,
 * and a substitution into it needs the def's own `sb_f_neq` and `neq_congr`.
 * Without them ∀E refused `¬ b = a` from `∀ x ¬ x = a`, whichever way the
 * student wrote it.
 */
describe("forallx: Calgary inequality under substitution", () => {
  const mm0 = stripSyntaxAnnotations(
    THEORY_SOURCES["forallx-calgary.mm0"] ?? "",
  );

  for (const [premise, instance] of [
    ["∀ x (¬ (x = a))", "¬ (b = a)"],
    ["∀ x (x ≠ a)", "b ≠ a"],
  ] as const) {
    test(`∀E from ${premise} to ${instance}`, async () => {
      const goal = `theorem t {x: var} {a b: name}: $ emp ⊢ (${premise}) $ > $ emp ; emp ⊢ (${instance}) $;`;
      const proof = `t\n----\nl1: $ emp ; emp ⊢ (${instance}) $ by all_elim [#1]\n`;
      const result = (await engine()).compile(`${mm0}\n${goal}\n`, proof);

      expect(result.ok).toBe(true);
    });
  }
});
