import { describe, expect, test } from "bun:test";

import {
  fitchLineDepths,
  fitchScopeGeometry,
  fitchToAuf,
} from "../src/worker/exercises/aufbau-proof-fitch/translate";

/**
 * The crux of the Fitch type: indentation → sequent contexts. Every line carries
 * its **ambient** context — the assumptions of every scope still open at that
 * line, the textbook accessibility set — and the house theories' slack context
 * variables (implicit weakening) absorb whatever a cited shallower line's
 * smaller context doesn't cover. Each `.auf` here is one the real `@aufbau`
 * compiler+verifier accepts against the propositional sequent-ND theory, so
 * these assertions pin the translator to output the engine actually verifies.
 * Indentation is built from explicit line arrays so leading whitespace is
 * unambiguous.
 */

function translate(lines: string[], goal: string): string {
  return fitchToAuf(lines.join("\n"), goal, "ax", "⊢").proofText;
}

describe("fitchToAuf — engine-verified shapes", () => {
  test("single-assumption discharge collapses to the empty context `_`", () => {
    const proofText = translate(
      ["    a       :ax", "a → a       :imp_intro 1-1"],
      "self",
    );

    expect(proofText).toBe(
      [
        "self",
        "----",
        "l1: $ a ⊢ a $ by ax []",
        "l2: $ _ ⊢ a → a $ by imp_intro [l1]",
      ].join("\n"),
    );
  });

  test("two premises share one ambient context (imp_elim)", () => {
    const proofText = translate(
      ["a → b   :ax", "a       :ax", "b       :imp_elim 1 2"],
      "mp",
    );

    expect(proofText).toBe(
      [
        "mp",
        "----",
        "l1: $ a → b , a ⊢ a → b $ by ax []",
        "l2: $ a → b , a ⊢ a $ by ax []",
        "l3: $ a → b , a ⊢ b $ by imp_elim [l1, l2]",
      ].join("\n"),
    );
  });

  test("nested discharge + reiteration (the K combinator)", () => {
    const proofText = translate(
      [
        "    a           :ax",
        "        b       :ax",
        "        a       :ax",
        "    b → a       :imp_intro 2-3",
        "a → (b → a)     :imp_intro 1-4",
      ],
      "kcomb",
    );

    expect(proofText).toBe(
      [
        "kcomb",
        "----",
        "l1: $ a ⊢ a $ by ax []",
        "l2: $ a , b ⊢ b $ by ax []",
        "l3: $ a , b ⊢ a $ by ax []",
        "l4: $ a ⊢ b → a $ by imp_intro [l3]",
        "l5: $ _ ⊢ a → (b → a) $ by imp_intro [l4]",
      ].join("\n"),
    );
  });

  test("a multi-premise rule's line still reads its own ambient (and_intro)", () => {
    const proofText = translate(
      [
        "a ∧ b   :ax",
        "b       :and_elim_r 1",
        "a       :and_elim_l 1",
        "b ∧ a   :and_intro 2 3",
      ],
      "andcomm",
    );

    expect(proofText).toBe(
      [
        "andcomm",
        "----",
        "l1: $ a ∧ b ⊢ a ∧ b $ by ax []",
        "l2: $ a ∧ b ⊢ b $ by and_elim_r [l1]",
        "l3: $ a ∧ b ⊢ a $ by and_elim_l [l1]",
        "l4: $ a ∧ b ⊢ b ∧ a $ by and_intro [l2, l3]",
      ].join("\n"),
    );
  });

  test("a nested line carries its full ambient; the assumption discharges over it", () => {
    // The reason contexts are ambient and the theory rules carry slack: the
    // ∧I line at depth 1 cites two depth-0 lines, so its context (a , b , c)
    // exceeds the join of the cited ones (a , b) — the rule's slack variable
    // absorbs c. The →I line then finds c in its cited line's context and
    // discharges it. Neither line compiles under join-of-cited emission.
    const proofText = translate(
      [
        "a               :ax",
        "b               :ax",
        "    c           :ax",
        "    a ∧ b       :and_intro 1 2",
        "c → (a ∧ b)     :imp_intro 3-4",
      ],
      "nested",
    );

    expect(proofText).toBe(
      [
        "nested",
        "----",
        "l1: $ a , b ⊢ a $ by ax []",
        "l2: $ a , b ⊢ b $ by ax []",
        "l3: $ a , b , c ⊢ c $ by ax []",
        "l4: $ a , b , c ⊢ a ∧ b $ by and_intro [l1, l2]",
        "l5: $ a , b ⊢ c → (a ∧ b) $ by imp_intro [l4]",
      ].join("\n"),
    );
  });

  test("vacuous discharge: assume, reiterate past, discharge (a ⊢ b → a)", () => {
    // The reiterated line's ambient carries b even though the derivation never
    // uses it, so imp_intro's `g , b ⊢ a` premise matches — the textbook
    // assume-and-reiterate proof of a vacuous conditional.
    const proofText = translate(
      [
        "a           :ax",
        "    b       :ax",
        "    a       :reit 1",
        "b → a       :imp_intro 2-3",
      ],
      "vacuous",
    );

    expect(proofText).toBe(
      [
        "vacuous",
        "----",
        "l1: $ a ⊢ a $ by ax []",
        "l2: $ a , b ⊢ b $ by ax []",
        "l3: $ a , b ⊢ a $ by reit [l1]",
        "l4: $ a ⊢ b → a $ by imp_intro [l3]",
      ].join("\n"),
    );
  });
});

describe("fitchToAuf — details", () => {
  test("blank lines are ignored and do not shift step numbers", () => {
    const proofText = translate(
      ["a → b   :ax", "", "a       :ax", "b       :imp_elim 1 2"],
      "mp",
    );

    expect(proofText).toContain("l3: $ a → b , a ⊢ b $ by imp_elim [l1, l2]");
  });

  test("a custom assumption rule name is honoured", () => {
    const proofText = fitchToAuf(
      ["    a   :assume", "a → a   :imp_intro 1-1"].join("\n"),
      "self",
      "assume",
      "⊢",
    ).proofText;

    expect(proofText).toContain("l1: $ a ⊢ a $ by assume []");
    expect(proofText).toContain("l2: $ _ ⊢ a → a $ by imp_intro [l1]");
  });

  test("a custom sequent symbol is written into every emitted line", () => {
    // An ASCII theory spells its turnstile `|-`; the student's Fitch source is
    // unchanged (it never writes a sequent), only the emission moves.
    const proofText = fitchToAuf(
      ["    a   :ax", "a → a   :imp_intro 1-1"].join("\n"),
      "self",
      "ax",
      "|-",
    ).proofText;

    expect(proofText).toContain("l1: $ a |- a $ by ax []");
    expect(proofText).toContain("l2: $ _ |- a → a $ by imp_intro [l1]");
    expect(proofText).not.toContain("⊢");
  });

  test("lineSpans map each generated line back to its source line", () => {
    const result = fitchToAuf(
      ["a → b   :ax", "a       :ax", "b       :imp_elim 1 2"].join("\n"),
      "mp",
      "ax",
      "⊢",
    );

    expect(result.lineSpans.map((span) => span.sourceLine)).toEqual([
      0, 1, 2,
    ]);
    for (const span of result.lineSpans) {
      const slice = result.proofText.slice(span.from, span.to);
      expect(slice.startsWith("l")).toBe(true);
    }
  });
});

describe("fitchLineDepths — scope-line depths", () => {
  test("nested subproofs report their depth; blanks are null", () => {
    const depths = fitchLineDepths(
      [
        "    a           :ax",
        "        b       :ax",
        "",
        "        a       :ax",
        "    b → a       :imp_intro 2-3",
        "a → (b → a)     :imp_intro 1-4",
      ].join("\n"),
    );

    expect(depths).toEqual([1, 2, null, 2, 1, 0]);
  });
});

describe("fitchScopeGeometry — bars sit at the typed indentation", () => {
  test("each line reports its enclosing scopes' indentation columns", () => {
    const geometry = fitchScopeGeometry(
      [
        "    a           :ax",
        "        b       :ax",
        "",
        "        a       :ax",
        "    b → a       :imp_intro 2-3",
        "a → (b → a)     :imp_intro 1-4",
      ].join("\n"),
      "ax",
    );

    // Each entry's `columns` is a subproof's content column: a depth-1 line sits
    // in one subproof (content at column 4); a depth-2 line sits in two (columns
    // 4 and 8). The top-level conclusion has no bar; a blank line is null.
    // `openFrom` marks the innermost freshly-opened bar: line 0 and line 1 each
    // open a subproof; line 3 reiterates `a` into the still-open inner box (no
    // new box, so nothing opens); the closing lines open nothing.
    expect(geometry).toEqual([
      { columns: [4], openFrom: 0 },
      { columns: [4, 8], openFrom: 1 },
      null,
      { columns: [4, 8], openFrom: 2 },
      { columns: [4], openFrom: 1 },
      { columns: [], openFrom: 0 },
    ]);
  });

  test("a common leading indent is kept, not stripped, so bars track the text", () => {
    const geometry = fitchScopeGeometry(
      ["  a     :ax", "      b :ax", "  c     :imp_intro 1-2"].join("\n"),
      "ax",
    );

    // The whole proof is indented by 2, so the top-level lines have no bar and
    // the subproof's content column is 6 (where the indented `b` sits).
    expect(geometry).toEqual([
      { columns: [], openFrom: 0 },
      { columns: [6], openFrom: 0 },
      { columns: [], openFrom: 0 },
    ]);
  });

  test("a sibling subproof reopens the innermost bar (a seam between boxes)", () => {
    const geometry = fitchScopeGeometry(
      [
        "a ∨ b       :ax",
        "    a       :ax",
        "    b ∨ a   :or_intro_r 2",
        "    b       :ax",
        "    b ∨ a   :or_intro_l 4",
        "b ∨ a       :or_elim 1 2-3 4-5",
      ].join("\n"),
      "ax",
    );

    // Both subproofs sit at column 4, but the second assumption (`b`, line 3)
    // opens a *new* box after the first derived a line — so its bar reopens
    // (`openFrom: 0`), which the client draws with a seam, while the derived
    // lines inside each box continue the strut (`openFrom: 1`).
    expect(geometry).toEqual([
      { columns: [], openFrom: 0 },
      { columns: [4], openFrom: 0 },
      { columns: [4], openFrom: 1 },
      { columns: [4], openFrom: 0 },
      { columns: [4], openFrom: 1 },
      { columns: [], openFrom: 0 },
    ]);
  });
});

describe("fitchToAuf — structural diagnostics", () => {
  test("a line with no justification is reported", () => {
    const { diagnostics } = fitchToAuf("a → b", "g", "ax", "⊢");

    expect(diagnostics.map((d) => d.code)).toContain("missing_justification");
  });

  test("a forward reference is rejected", () => {
    const { diagnostics } = fitchToAuf(
      ["a       :imp_elim 2", "a → b   :ax"].join("\n"),
      "g",
      "ax",
      "⊢",
    );

    expect(diagnostics[0]?.code).toBe("unknown_reference");
    expect(diagnostics[0]?.sourceLine).toBe(0);
    // The offending token travels as a parameter, not baked into prose, so the
    // sentence around it can be translated.
    expect(diagnostics[0]?.params).toEqual({ token: "2" });
  });

  test("a non-numeric reference token is rejected", () => {
    const { diagnostics } = fitchToAuf("a   :imp_elim x", "g", "ax", "⊢");

    expect(diagnostics.map((d) => d.code)).toContain("bad_reference");
    expect(
      diagnostics.find((d) => d.code === "bad_reference")?.params,
    ).toEqual({ token: "x" });
  });

  test("indentation that matches no open level is reported", () => {
    const { diagnostics } = fitchToAuf(
      ["a       :ax", "    b   :ax", "  c     :imp_elim 1 2"].join("\n"),
      "g",
      "ax",
      "⊢",
    );

    expect(diagnostics.map((d) => d.code)).toContain(
      "inconsistent_indentation",
    );
  });

  test("a subproof range whose ends are at different depths is rejected", () => {
    // Line 3's `a` is one subproof deeper than line 2's `b`, so `2-3` does not
    // name a single subproof even though `l3`'s context happens to discharge.
    const { diagnostics } = fitchToAuf(
      [
        " a :ax",
        "  b :ax",
        "   a :ax",
        " b → a :imp_intro 2-3",
        "a → (b → a) :imp_intro 1-4",
      ].join("\n"),
      "kcomb",
      "ax",
      "⊢",
    );

    expect(diagnostics.map((d) => d.code)).toContain("range_depth_mismatch");
    expect(
      diagnostics.find((d) => d.code === "range_depth_mismatch")?.sourceLine,
    ).toBe(3);
  });

  test("a well-formed subproof range at one depth is accepted", () => {
    const { diagnostics } = fitchToAuf(
      [
        "    a           :ax",
        "        b       :ax",
        "        a       :ax 1",
        "    b → a       :imp_intro 2-3",
        "a → (b → a)     :imp_intro 1-4",
      ].join("\n"),
      "kcomb",
      "ax",
      "⊢",
    );

    expect(diagnostics).toEqual([]);
  });

  test("a plain ref into a closed subproof is inaccessible", () => {
    const { diagnostics } = fitchToAuf(
      [
        "p           :ax",
        "    a       :ax",
        "    p       :reit 1",
        "p ∧ p       :and_intro 3 3",
      ].join("\n"),
      "g",
      "ax",
      "⊢",
    );

    expect(
      diagnostics.filter((d) => d.code === "inaccessible_reference"),
    ).toEqual([
      {
        code: "inaccessible_reference",
        params: { token: "3" },
        sourceLine: 3,
      },
      {
        code: "inaccessible_reference",
        params: { token: "3" },
        sourceLine: 3,
      },
    ]);
  });

  test("re-assuming the same formula does not reopen a closed subproof", () => {
    // The one violation the engine cannot reject: the new box assumes `a`
    // again, so the cited line's sequent fits the new ambient exactly and
    // verifies — sound, but not Fitch. Scope ids are fresh per box, so the
    // translator still names it.
    const { diagnostics } = fitchToAuf(
      [
        "    a           :ax",
        "    a ∧ a       :and_intro 1 1",
        "a → (a ∧ a)     :imp_intro 1-2",
        "    a           :ax",
        "    a ∧ a       :reit 2",
        "a → (a ∧ a)     :imp_intro 4-5",
      ].join("\n"),
      "g",
      "ax",
      "⊢",
    );

    expect(diagnostics).toEqual([
      {
        code: "inaccessible_reference",
        params: { token: "2" },
        sourceLine: 4,
      },
    ]);
  });

  test("a subproof range inside a closed subproof is inaccessible", () => {
    const { diagnostics } = fitchToAuf(
      [
        "    a           :ax",
        "        b       :ax",
        "    b → b       :imp_intro 2-2",
        "a → (b → b)     :imp_intro 1-3",
        "b → b           :imp_intro 2-2",
      ].join("\n"),
      "g",
      "ax",
      "⊢",
    );

    expect(diagnostics).toEqual([
      {
        code: "inaccessible_reference",
        params: { token: "2-2" },
        sourceLine: 4,
      },
    ]);
  });

  test("citing ancestor-scope lines and just-closed immediate subproofs is fine", () => {
    const { diagnostics } = fitchToAuf(
      [
        "a ∨ b       :ax",
        "    a       :ax",
        "    b ∨ a   :or_intro_r 2",
        "    b       :ax",
        "    b ∨ a   :or_intro_l 4",
        "b ∨ a       :or_elim 1 2-3 4-5",
      ].join("\n"),
      "orcomm",
      "ax",
      "⊢",
    );

    expect(diagnostics).toEqual([]);
  });

  test("a range that dips back out to a shallower line is rejected", () => {
    // `1-4` runs depth-1 → depth-0 (line 2) → depth-1 again: two subproofs, not
    // one, even though its ends share a depth.
    const { diagnostics } = fitchToAuf(
      [
        " a :ax",
        "b :imp_intro 1",
        " c :ax",
        " d :imp_intro 3",
        "e :imp_intro 1-4",
      ].join("\n"),
      "g",
      "ax",
      "⊢",
    );

    expect(diagnostics.map((d) => d.code)).toContain(
      "range_escapes_subproof",
    );
  });
});
