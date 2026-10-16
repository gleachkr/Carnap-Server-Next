import { describe, expect, test } from "bun:test";
import { splitArgumentLine } from "../src/worker/exercise-kit/formula";

/** The kit's shared argument line, `premises :|-: conclusions`. */

describe("splitArgumentLine", () => {
  test("splits premises from conclusions, respecting brackets", () => {
    expect(splitArgumentLine("R(a,b), P :|-: Q")).toEqual({
      conclusions: ["Q"],
      premises: ["R(a,b)", "P"],
    });
  });

  test("drops a leading bullet and empty pieces", () => {
    expect(splitArgumentLine("- :|-: P ∨ ¬P")).toEqual({
      conclusions: ["P ∨ ¬P"],
      premises: [],
    });
  });

  test("refuses a second turnstile", () => {
    expect(splitArgumentLine("P :|-: Q :|-: R")).toBeNull();
  });
});
