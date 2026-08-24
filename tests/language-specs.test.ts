import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { parseSpec, printTerm, type SurfaceLanguage } from "@aufbau/syntax";
import {
  LANGUAGE_SPEC_SOURCES,
  languageById,
} from "../src/worker/logic/specs";

/**
 * The specs in `src/worker/logic/specs` are build-time artifacts of ours, so
 * every one of them has to read clean — `languageById` throws rather than
 * degrading, and this is what keeps that throw unreachable.
 *
 * The behavioral cases below are not a re-test of `@aufbau/syntax`, which has
 * its own corpus. They pin that *these copies* are still the languages the
 * incumbent parsers speak, so a later edit to a spec cannot quietly change
 * what a student may write.
 */

const SPECS_DIR = resolve(import.meta.dir, "../src/worker/logic/specs");

function language(id: string): SurfaceLanguage {
  const found = languageById(id);

  if (found === null) {
    throw new Error(`no spec ships under the id ${id}`);
  }

  return found;
}

function display(id: string, source: string): string {
  const lang = language(id);
  const result = lang.parse(source);

  if (!result.ok) {
    throw new Error(
      `expected '${source}' to parse under ${id}: ${result.diagnostics
        .map((one) => one.id)
        .join(", ")}`,
    );
  }

  return printTerm(lang, result.term, "display");
}

function refusal(id: string, source: string): readonly string[] {
  const lang = language(id);
  const result = lang.parse(source);

  if (result.ok) {
    throw new Error(
      `expected '${source}' to be refused under ${id}, got ${printTerm(
        lang,
        result.term,
        "display",
      )}`,
    );
  }

  return result.diagnostics.map((one) => one.id);
}

describe("language specs", () => {
  test("every shipped spec reads without a diagnostic", () => {
    const ids = Object.keys(LANGUAGE_SPEC_SOURCES);

    // Cheap proof this test is not vacuous.
    expect(ids.length).toBeGreaterThan(0);

    for (const id of ids) {
      const { diagnostics } = parseSpec(LANGUAGE_SPEC_SOURCES[id] ?? "");

      expect({ id, diagnostics }).toEqual({ id, diagnostics: [] });
    }
  });

  test("every `.mm0` in the directory is registered under its own name", async () => {
    const files = (await readdir(SPECS_DIR))
      .filter((name) => name.endsWith(".mm0"))
      .map((name) => name.slice(0, -".mm0".length))
      .sort();

    expect(files).toEqual(Object.keys(LANGUAGE_SPEC_SOURCES).sort());
  });

  test("an id no spec ships under is `null`, not a throw", () => {
    expect(languageById("forallx-magnus")).toBeNull();
  });

  test("a language is built once and shared", () => {
    expect(languageById("carnap-prop")).toBe(languageById("carnap-prop"));
  });

  describe("carnap-prop", () => {
    const id = "carnap-prop";

    test("atoms are single Roman letters of either case", () => {
      expect(display(id, "p/\\Z")).toBe("(p /\\ Z)");
      // The incumbent's bare-digit subscript is the documented casualty.
      expect(refusal(id, "P0")).toContain("unrecognized_chunk");
    });

    test("five rungs: ~ over /\\ over \\/ over -> over <->", () => {
      expect(display(id, "P/\\Q\\/R")).toBe("((P /\\ Q) \\/ R)");
      expect(display(id, "~P/\\Q")).toBe("(~P /\\ Q)");
      expect(display(id, "P\\/Q->R")).toBe("((P \\/ Q) -> R)");
      expect(display(id, "P->Q<->R")).toBe("((P -> Q) <-> R)");
    });

    test("every rung chains, and -> chains to the right", () => {
      expect(display(id, "P->Q->R")).toBe("(P -> (Q -> R))");
      expect(display(id, "P<->Q<->R")).toBe("((P <-> Q) <-> R)");
    });

    test("parentheses may enclose anything", () => {
      expect(display(id, "(P)")).toBe("P");
      expect(display(id, "(~P)")).toBe("~P");
    });

    test("connectives are ASCII only", () => {
      expect(refusal(id, "P ∧ Q")).toContain("unrecognized_chunk");
    });
  });

  describe("forallx-calgary-2019", () => {
    const id = "forallx-calgary-2019";

    test("reads tight textbook notation and prints logical symbols", () => {
      expect(display(id, "AxEy~R(x,y)")).toBe("∀x∃y¬R(x,y)");
      expect(display(id, "Ax(F(x) -> G(f(x)))")).toBe("∀x(F(x) → G(f(x)))");
      expect(display(id, "a != b")).toBe("a≠b");
      expect(display(id, "!?")).toBe("⊥");
    });

    test("predicates take parentheses; juxtaposition is the other edition", () => {
      expect(refusal(id, "Fab")).toContain("unexpected_token");
    });

    test("the conditional rung refuses to chain", () => {
      expect(refusal(id, "P -> Q -> R")).toContain("chain_refused");
    });

    test("a group may enclose only a binary compound", () => {
      expect(refusal(id, "(P)")).toContain("group_binary_only");
      expect(display(id, "[P /\\ Q] \\/ R")).toBe("(P ∧ Q) ∨ R");
    });

    test("every sentence is closed", () => {
      expect(refusal(id, "F(x)")).toContain("free_variable");
    });

    test("engine mode writes the elided argument sequence out", () => {
      const lang = language(id);
      const result = lang.parse("P /\\ F(a)");

      if (!result.ok) {
        throw new Error("expected 'P /\\ F(a)' to parse");
      }

      expect(printTerm(lang, result.term, "engine")).toBe(
        "((P (snil)) ∧ (F (a (snil))))",
      );
    });
  });
});
