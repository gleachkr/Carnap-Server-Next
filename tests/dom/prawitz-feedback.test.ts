import { describe, expect, test } from "bun:test";
import { mountExercise, typeInto, until } from "./mount-exercise";
import {
  PRAWITZ_THEORY,
  prawitzButton,
  prawitzExercise,
  prawitzFormulaFieldOf,
  prawitzItems,
} from "./prawitz-widget";
import { mockProofCompiler } from "./proof-compiler-mock";

/**
 * What `<carnap-aufbau-proof-prawitz>` says on a line, and when it says
 * nothing. A reason on a line — the language's refusal of a formula, the
 * translator's structural complaint, a compiler diagnostic — is detail, and
 * `feedback="terse"` withholds detail. The parser's refusals used to reach
 * the line regardless: only the compiler's diagnostics were gated.
 *
 * Beside it, the one failure that used to say nothing at all: a compiler
 * that threw rather than reported left the forest blank and the spinner
 * stopped. The linear and Fitch editors put a sentence at the top of the
 * body for that; here it goes on the root line.
 */

const ENGINE_FAILURE =
  "The proof engine couldn't read this proof — check for unexpected characters.";

const compile = await mockProofCompiler();

await import("../../src/client/components/carnap-aufbau-proof-prawitz-v1");

/**
 * The shared theory, made a *language*: with a sentence role and its
 * delimiters declared, a line is read before it reaches the compiler, and
 * `top →` is something the language can refuse.
 */
const READING_THEORY = PRAWITZ_THEORY.replace(
  "provable sort wff;",
  "--| @syntax delimiter $ top → ( ) $\n--| @syntax role sentence\nprovable sort wff;",
);

/** The first line's formula field, after a fresh assumption is typed into. */
async function typedLine(
  feedback: "full" | "terse",
  text: string,
): Promise<HTMLElement> {
  const mounted = mountExercise(await prawitzExercise("", READING_THEORY), {
    options: { feedback },
  });
  prawitzButton(mounted, "New assumption").click();
  const [only] = prawitzItems(mounted);
  const field = prawitzFormulaFieldOf(only as HTMLElement);
  typeInto(field, text);
  return field;
}

describe("Prawitz feedback", () => {
  test("a formula the language refuses is underlined, with the reason", async () => {
    const field = await typedLine("full", "top →");

    await until(() => field.classList.contains("is-error"));
    expect(field.getAttribute("title")).toBe("Expected a formula.");
  });

  test("terse feedback withholds the refusal too", async () => {
    const field = await typedLine("terse", "top →");

    // The compile is never reached for a formula the language refused, so
    // there is nothing to wait for but the render; a tick is enough.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(field.classList.contains("is-error")).toBe(false);
    expect(field.getAttribute("title")).toBeNull();
  });

  test("a compiler that throws is reported on the root line", async () => {
    compile.mockImplementationOnce(() => {
      throw new Error("wasm trap");
    });
    const field = await typedLine("full", "top");

    // The empty assumption was refused before `top` was typed, so the
    // underline is there already; what changes is the sentence.
    await until(() => field.getAttribute("title") === ENGINE_FAILURE);
    expect(field.classList.contains("is-error")).toBe(true);
  });

  test("and terse feedback withholds that sentence as well", async () => {
    compile.mockImplementationOnce(() => {
      throw new Error("wasm trap");
    });
    const field = await typedLine("terse", "top");

    await until(() => compile.mock.calls.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(field.classList.contains("is-error")).toBe(false);
  });
});
