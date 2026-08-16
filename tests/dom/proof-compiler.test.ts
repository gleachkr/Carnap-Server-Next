import { describe, expect, mock, test } from "bun:test";
import { domDocument } from "../helpers/dom";

/**
 * The shared Aufbau compiler loader: that the engine is asked for the reader's
 * language, and asked exactly once per page.
 *
 * Both halves matter and only one of them is obvious. Since
 * `@aufbau/compiler@0.0.5` the engine words its own diagnostics in a language
 * chosen at load time, so a German reader who left the locale on the document
 * would get German prose from us and English squiggles from the engine. The
 * second half is why the choice lives in one module: `set_locale` applies to the
 * instance, so two widgets loading their own compilers could disagree, and the
 * first one to finish would decide for both.
 *
 * `@aufbau/compiler` is mocked because the real thing wants a 5 MB wasm over
 * HTTP, and nothing here is about compiling a proof.
 */

const loadCompiler = mock(
  async (_options: { locale?: string; wasmUrl?: string }) => ({
    compile: () => ({ ok: true }),
  }),
);

mock.module("@aufbau/compiler", () => ({ loadCompiler }));

// After the mock is registered: the module under test reaches the package
// through a dynamic `import()`, so registration only has to precede the *call*,
// but importing it late keeps the ordering obvious to the next reader.
const { loadProofCompiler, proofCompilerLocale } = await import(
  "../../src/client/proof-compiler"
);

describe("proofCompilerLocale", () => {
  test("is the document's own language", () => {
    domDocument.documentElement.lang = "de";

    expect(proofCompilerLocale()).toBe("de");
  });

  test("is undefined when the document does not say", () => {
    // Not `""`: an empty tag would be a claim about a language, and the engine's
    // option is absent-or-a-tag. It leaves the engine on its default.
    domDocument.documentElement.lang = "   ";

    expect(proofCompilerLocale()).toBeUndefined();
  });
});

describe("loadProofCompiler", () => {
  test("asks for the reader's language, once for the whole page", async () => {
    domDocument.documentElement.lang = "de";

    const first = await loadProofCompiler();

    expect(loadCompiler).toHaveBeenCalledTimes(1);
    expect(loadCompiler.mock.calls[0]?.[0]).toMatchObject({ locale: "de" });

    // A second widget on the same page gets the instance the first one made —
    // it does not re-instantiate, and cannot re-decide the language.
    domDocument.documentElement.lang = "en";

    expect(await loadProofCompiler()).toBe(first);
    expect(loadCompiler).toHaveBeenCalledTimes(1);
  });
});
