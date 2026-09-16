import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { loadCompiler } from "@aufbau/compiler";
import { verifyMmb } from "../src/worker/exercise-kit/proof/verifier";

/**
 * The trust boundary against an admitted line. Since engine 0.0.9 a proof may
 * justify a line with `sorry!`; the compiler still issues a certificate, with
 * a `Sorry` instruction at that line. Grading is `verifyMmb` against the
 * frozen theory, and the verifier reports such a certificate as not ok — so
 * whatever a client sends, an admitted line never scores. (The widgets do not
 * send one; `tests/dom/compile-verdict.test.ts` covers that half.)
 */

const MM0 = `delimiter $ ( ) $;
provable sort wff;
term imp (a b: wff): wff; infixr imp: $->$ prec 25;
axiom mp (a b: wff): $ a $ > $ a -> b $ > $ b $;
theorem goal (p q: wff): $ p $ > $ q $;
`;

test("a certificate that admits a line does not verify", async () => {
  const compiler = await loadCompiler({
    wasmBytes: readFileSync(
      new URL(
        "../node_modules/@aufbau/compiler/compiler.wasm",
        import.meta.url,
      ),
    ),
  });
  const result = compiler.compile(
    MM0,
    "goal\n----\nl1: $ p -> q $ by sorry!\nl2: $ q $ by mp [#1, l1]\n",
  );

  // The compiler's view, which `readCompileResult` reads the other way
  // (`tests/dom/compile-verdict.test.ts`): compiled, certificate issued, and
  // one warning naming the admitted line.
  expect(result.ok).toBe(true);
  expect(result.mmbBytes).toBeInstanceOf(Uint8Array);
  expect(
    (result.diagnostics as readonly { readonly error?: unknown }[]).map(
      (one) => one.error,
    ),
  ).toEqual(["SorryLine"]);

  expect(await verifyMmb(MM0, result.mmbBytes as Uint8Array)).toEqual({
    errored: false,
    ok: false,
  });
});
