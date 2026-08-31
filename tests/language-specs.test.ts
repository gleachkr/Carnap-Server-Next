import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { parseSpec, printTerm, type SurfaceLanguage } from "@aufbau/syntax";
import {
  LANGUAGE_SPEC_SOURCES,
  languageById,
  languageFromSource,
} from "../src/worker/logic/specs";
import { sentenceSort } from "../src/worker/logic/specs/roles";
import { THEORY_SOURCES } from "../src/worker/logic/theories";

/**
 * The specs `languageById` serves are build-time artifacts of ours, so every
 * one of them has to read clean — it throws rather than degrading, and this is
 * what keeps that throw unreachable.
 *
 * None of them are files in `src/worker/logic/specs`: every MM0 artifact lives
 * in `logic/theories`, whether it is a proof system, a language, or — as
 * forallx: Calgary is — both. That is the whole point of the convergence, since
 * it is what makes `system=` and a proof block's `src=` resolve to the same
 * bytes, so the pairing is asserted here directly.
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
  test("every shipped spec reads without an error", () => {
    const ids = Object.keys(LANGUAGE_SPEC_SOURCES);

    // Cheap proof this test is not vacuous.
    expect(ids.length).toBeGreaterThan(0);

    for (const id of ids) {
      const errors = parseSpec(LANGUAGE_SPEC_SOURCES[id] ?? "")
        .diagnostics.filter((one) => one.severity === "error")
        .map((one) => one.id);

      expect({ errors, id }).toEqual({ errors: [], id });
    }
  });

  /**
   * The one warning a spec is allowed, and only where it is the truth: a file
   * that is also a proof theory declares notations — the turnstile, the
   * equational layer, the substitution terms — that no student can type, so
   * they are not in the surface delimiter set and the reader says so. Pinning
   * the *tokens* rather than the count is what keeps this from becoming a
   * licence to leave a real one unread: a connective drifting into this list
   * would fail here.
   */
  test("a spec's only warnings name its engine-only notations", () => {
    const engineOnly: Readonly<Record<string, readonly string[]>> = {
      "carnap-prop": [],
      "forallx-calgary-2019": [
        "tsub",
        "subst",
        "_",
        "⊢",
        "⟺",
        "≐",
        "≗",
        "≜",
        "⟚",
      ],
    };

    for (const [id, tokens] of Object.entries(engineOnly)) {
      const warnings = parseSpec(LANGUAGE_SPEC_SOURCES[id] ?? "").diagnostics;

      expect({
        id,
        seen: warnings.map((one) => [one.id, one.params.token]),
      }).toEqual({
        id,
        seen: tokens.map((token) => ["delimiter_token_not_delimited", token]),
      });
    }
  });

  /**
   * The artifacts all live in one directory, so an id is a file's stem and its
   * text is that file's — no second copy, no second home, and nothing for a
   * language and the proof system built over it to disagree about. Asserting
   * it byte for byte is what keeps a well-meaning "just inline this one" from
   * reintroducing the split.
   */
  test("a language id is an artifact's stem, and its text is that file's", () => {
    for (const [id, source] of Object.entries(LANGUAGE_SPEC_SOURCES)) {
      expect({ id, source }).toEqual({
        id,
        source: THEORY_SOURCES[`${id}.mm0`] ?? "",
      });
    }
  });

  test("nothing but the reading end is left in `logic/specs`", async () => {
    expect(
      (await readdir(SPECS_DIR)).filter((name) => name.endsWith(".mm0")),
    ).toEqual([]);
  });

  test("an id no spec ships under is `null`, not a throw", () => {
    // `gentzen-lk` is the pointed case: a theory that ships, is named by the
    // same stem convention, and is *not* a language — it declares no `@syntax`
    // at all. Registering it would have to be deliberate.
    expect(languageById("gentzen-lk")).toBeNull();
  });

  test("a language is built once and shared", () => {
    expect(languageById("carnap-prop")).toBe(languageById("carnap-prop"));
  });

  describe("carnap-prop", () => {
    const id = "carnap-prop";

    test("atoms are single Roman letters of either case", () => {
      expect(display(id, "p/\\Z")).toBe("(p /\\ Z)");
      // The incumbent's bare-digit subscript is the documented casualty — of
      // the *shipped signature*, which declares 52 atoms and no `P0`. It is no
      // longer a casualty of segmentation: see the next test.
      expect(refusal(id, "P0")).toContain("unrecognized_chunk");
    });

    test("a course can add a word to the atoms, and tight input still reads", () => {
      // The letters are deliberately not in this spec's delimiter set
      // (2026-08-28). Nothing propositional needs them — `~` bounds its own
      // operand and every connective spelling self-delimits — and declaring
      // them cost the whole multi-character lexicon, a delimiter being a
      // property of a *string*: with `P` and `R` declared, `Rain` segments as
      // `R a i n` and the reader refuses the name outright.
      const extended = languageFromSource(
        `${LANGUAGE_SPEC_SOURCES[id] ?? ""}\nterm Rain: wff;\nterm P1: wff;\n`,
      );

      if (extended === null) {
        throw new Error("carnap-prop plus two atoms does not read");
      }

      const parsed = extended.parse("~Rain->P1");

      expect(parsed.ok).toBe(true);
      expect(parsed.ok && printTerm(extended, parsed.term, "display")).toBe(
        "(~Rain -> P1)",
      );
      // The half the letters were supposed to be buying, which they never were.
      expect(display(id, "~~P")).toBe("~~P");
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

    /**
     * The whole reason one file can be both a language and a proof system. The
     * theory's judgements live in a sort of their own, student input is read
     * at the sort `@syntax role sentence` names, and so a sequent cannot be
     * built where a sentence belongs — checkable rather than merely intended.
     */
    test("a sequent is not a sentence, and the spec says which sort is", () => {
      const lang = language(id);

      expect(sentenceSort(lang)).toBe("wff");
      expect(
        lang.parse("P ⊢ Q", { sort: "wff" }).ok ? "parsed" : "refused",
      ).toBe("refused");
      // A proof widget reading the same file at the judgement sort gets one.
      expect(lang.parse("P ; Q ⊢ P", { sort: "judgement" }).ok).toBe(true);
    });

    test("engine mode writes the elided argument sequence out", () => {
      const lang = language(id);
      const result = lang.parse("P /\\ F(a)");

      if (!result.ok) {
        throw new Error("expected 'P /\\ F(a)' to parse");
      }

      // `a` is a `@vars` token at the `name` sort, not a letter with an
      // argument sequence of its own, so it writes out bare — the constants
      // and the function letters part company at f.
      expect(printTerm(lang, result.term, "engine")).toBe(
        "((P (snil)) ∧ (F (a)))",
      );
      const applied = lang.parse("P /\\ F(f)");

      if (!applied.ok) {
        throw new Error("expected 'P /\\ F(f)' to parse");
      }

      expect(printTerm(lang, applied.term, "engine")).toBe(
        "((P (snil)) ∧ (F (f (snil))))",
      );
    });
  });

  describe("forallx-magnus", () => {
    const id = "forallx-magnus";

    test("atomic sentences are juxtaposed, and print that way", () => {
      expect(display(id, "Rab")).toBe("Rab");
      expect(display(id, "@x3yRxy")).toBe("∀x∃yRxy");
      // Parenthesised arguments are the *other* edition's spelling, but they
      // read here too — a group around a single argument, or around the
      // sequence — which is what lets a goal statement's engine text and a
      // student's line be the same string.
      expect(display(id, "F(a)")).toBe("Fa");
      expect(display(id, "R(a,b)")).toBe("Rab");
    });

    test("conjunction prints as `&`, this book's own glyph", () => {
      expect(display(id, "P /\\ Q")).toBe("P & Q");
      expect(display(id, "~Fa & ~Ga")).toBe("¬Fa & ¬Ga");
    });

    test("two rungs: ∧ and ∨ tighter than → and ↔, and neither pair chains", () => {
      expect(display(id, "P & Q \\/ R")).toBe("(P & Q) ∨ R");
      // The nesting Calgary refuses is exactly what a second rung is for.
      expect(display(id, "P & Q -> R")).toBe("(P & Q) → R");
      expect(refusal(id, "P -> Q -> R")).toContain("chain_refused");
      expect(refusal(id, "P -> Q <-> R")).toContain("mix_refused");
    });

    test("`A` stays a predicate letter and `v` stays a name", () => {
      // Carnap reads `AxFx` as `∀x Fx`, resolving the collision by parser
      // try-order. An MM0 math token has one meaning, so this file spells the
      // quantifiers `@`/`3` instead and `A` never means ∀. `v` is one of the
      // names a–w, so it cannot be a disjunction either.
      expect(refusal(id, "AxFx")).toContain("unexpected_token");
      expect(refusal(id, "P v Q")).toContain("unexpected_token");
      expect(display(id, "@xFx")).toBe("∀xFx");
    });

    test("every sentence is closed", () => {
      expect(refusal(id, "Fx")).toContain("free_variable");
    });

    test("a sequent is not a sentence, and the spec says which sort is", () => {
      const lang = language(id);

      expect(sentenceSort(lang)).toBe("wff");
      expect(
        lang.parse("P ⊢ Q", { sort: "wff" }).ok ? "parsed" : "refused",
      ).toBe("refused");
      expect(lang.parse("P ; Q ⊢ P", { sort: "judgement" }).ok).toBe(true);
    });

    test("engine mode writes the argument sequence out", () => {
      const lang = language(id);
      const result = lang.parse("P & Rab");

      if (!result.ok) {
        throw new Error("expected 'P & Rab' to parse");
      }

      // The elided empty sequence of a sentence letter, and the comma the
      // student never types — both are the engine's spelling, which is what
      // reaches the compiler.
      expect(printTerm(lang, result.term, "engine")).toBe(
        "((P (snil)) & (R (a , b)))",
      );
    });
  });
});
