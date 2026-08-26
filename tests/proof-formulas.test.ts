import { describe, expect, test } from "bun:test";

import {
  ENGINE_TEXT,
  frozenTheoryText,
  goalIsSchematic,
  hasTheoryText,
  proofFormulaReader,
  proofTheoryText,
  readNodeFormulas,
} from "../src/worker/exercises/aufbau-proof/formulas";
import { prawitzToAuf } from "../src/worker/exercises/aufbau-proof-prawitz/translate";
import type { PrawitzProofNode } from "../src/worker/exercises/aufbau-proof-prawitz/types";
import { flattenProofTree } from "../src/worker/exercises/aufbau-proof-tree/flatten";
import type { ProofTreeNode } from "../src/worker/exercises/aufbau-proof-tree/types";
import { theorySourceByFileName } from "../src/worker/logic/theories";
import {
  FORALLX_THEORY_MM0,
  FORALLX_THEORY_SOURCE,
} from "./helpers/forallx-theory";

/**
 * Reading a proof's formulas in the theory's own language (#250).
 *
 * The end-to-end claim — that what comes out is text the real Aufbau compiler
 * accepts and the verifier verifies — is `scripts/{forallx,prawitz}-verify.ts`,
 * which compile from source each run. What is pinned here is everything that
 * decides *whether* a formula is read at all, because that is where being wrong
 * is silent: a proof read when it should not be is a proof that used to compile
 * and no longer does, or worse, one that means something else.
 */

const GENTZEN = theorySourceByFileName("gentzen-lk.mm0");

const CONCRETE =
  "theorem t {x: var} {a: name}: $ ∀ x (F(x) → G(x)) ⊢ G(a) $;";

describe("proofFormulaReader", () => {
  const read = proofFormulaReader(FORALLX_THEORY_SOURCE, "sentence");

  test("textbook spellings come out as engine text", () => {
    expect(read("Ax(F(x)->G(x))")).toEqual({
      ok: true,
      text: "(∀ x ((F (x)) → (G (x))))",
    });
    expect(read("~F(a) /\\ G(a)")).toEqual({
      ok: true,
      text: "((¬ (F (a))) ∧ (G (a)))",
    });
  });

  test("the engine text an author already writes goes on reading", () => {
    // The whole existing corpus of starters and worked cases is spelled this
    // way, so this is the compatibility claim: turning the reader on must not
    // refuse a line anyone has already written.
    expect(read("∀ x (F(x) → G(x))")).toEqual({
      ok: true,
      text: "(∀ x ((F (x)) → (G (x))))",
    });
    expect(read("¬ F(a)")).toEqual({ ok: true, text: "(¬ (F (a)))" });
  });

  test("the printer's own output is not offered back to the reader", () => {
    // `printTerm(…, "engine")` parenthesizes every operand, including ones the
    // book's bracket rule refuses — `(F (x))` wraps an application, not a
    // two-place connective — so its output does not read as *surface* text.
    // That is not a round-trip failure, because nothing re-reads it: the
    // emitted `.auf` goes to the compiler, and what the student's answer stores
    // is the text they typed. This pins that the two directions stay separate.
    const engine = read("∀ x (F(x) → G(x))");
    expect(engine.ok).toBe(true);
    expect(engine.ok && read(engine.text).ok).toBe(false);
  });

  test("a refusal names the character it broke on", () => {
    const result = read("F(a) /\\");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors[0]?.message).toBe(
      "Expected a formula.",
    );
    expect(result.ok === false && result.errors[0]?.position).toBe(7);
  });

  test("the book's bracket discipline applies to a proof line", () => {
    // `=` is not a connective — its arguments are terms — so forallx's
    // `parenthesize-binary-only` refuses the parentheses. Before proofs were
    // read, only translation and model exercises were held to this.
    expect(read("∀ x (x = x)").ok).toBe(false);
    expect(read("∀ x x = x")).toEqual({ ok: true, text: "(∀ x (x = x))" });
  });

  test("a sequent shape reads at the sort the turnstile yields", () => {
    // The tree type's nodes state whole judgements, so reading them at the
    // sentence sort would refuse every one of them.
    const sequent = proofFormulaReader(FORALLX_THEORY_SOURCE, "sequent");

    expect(sequent("Ax(F(x)->G(x)) ; F(a) ⊢ G(a)")).toEqual({
      ok: true,
      text: "(((∀ x ((F (x)) → (G (x)))) ; (F (a))) ⊢ (G (a)))",
    });
    expect(read("Ax(F(x)->G(x)) ; F(a) ⊢ G(a)").ok).toBe(false);
  });

  test("a theory that is not a language passes everything through", () => {
    // `gentzen-lk` declares no `@syntax` at all, so it names no sentence sort
    // and nothing here is willing to guess one.
    const gentzen = proofFormulaReader(GENTZEN, "sequent");

    expect(gentzen("Γ ==> Δ")).toEqual({ ok: true, text: "Γ ==> Δ" });
    expect(gentzen("this is not a formula")).toEqual({
      ok: true,
      text: "this is not a formula",
    });
  });

  test("no source at all is the same pass-through", () => {
    // What a pre-#250 artifact hands over: it froze the stripped engine text
    // and nothing else, so there is no language to read it in.
    expect(proofFormulaReader(null, "sentence")).toBe(ENGINE_TEXT);
    expect(proofFormulaReader(undefined, "sentence")).toBe(ENGINE_TEXT);
  });
});

describe("goalIsSchematic", () => {
  test("a goal binding a provable sort is schematic", () => {
    expect(
      goalIsSchematic(
        "theorem mp (a b: wff): $ (a → b) ; a ⊢ b $;",
        FORALLX_THEORY_SOURCE,
      ),
    ).toBe(true);
  });

  test("binders drawn from lexicon sorts are not", () => {
    expect(goalIsSchematic(CONCRETE, FORALLX_THEORY_SOURCE)).toBe(false);
    expect(
      goalIsSchematic(
        "theorem eqreplace {a b: name}: $ a = b ; F(a) ⊢ F(b) $;",
        FORALLX_THEORY_SOURCE,
      ),
    ).toBe(false);
  });

  test("a hypothesis binder introduces no vocabulary", () => {
    // `(h: $ … $)` names a hypothesis, not a metavariable, and the math string
    // is cleared before the binder list is read so its `$` cannot be mistaken
    // for a sort name.
    expect(
      goalIsSchematic(
        "theorem h {a: name} (h: $ F(a) $): $ _ ⊢ F(a) $;",
        FORALLX_THEORY_SOURCE,
      ),
    ).toBe(false);
  });

  test("a theory that is not a language is never schematic", () => {
    // There is nothing to turn off: those proofs are engine text either way.
    expect(goalIsSchematic("theorem t (a b: wff): $ a ⊢ b $;", GENTZEN)).toBe(
      false,
    );
  });
});

describe("frozenTheoryText", () => {
  const theory = { mm0: FORALLX_THEORY_MM0, source: FORALLX_THEORY_SOURCE };

  test("a concrete goal freezes the artifact as written", () => {
    const frozen = frozenTheoryText(theory, CONCRETE);

    expect(frozen.mm0).toBeUndefined();
    expect(frozen.source).toBe(`${FORALLX_THEORY_SOURCE}\n${CONCRETE}`);
  });

  test("stripping the frozen source gives back the engine input exactly", () => {
    // The two texts differ by whole `@syntax` lines and nothing else, which is
    // what lets only one of them be frozen: a certificate is still verified
    // against `${theory}\n${goal}`, byte for byte.
    const resolved = proofTheoryText(frozenTheoryText(theory, CONCRETE));

    expect(resolved.mm0).toBe(`${FORALLX_THEORY_MM0}\n${CONCRETE}`);
    expect(resolved.source).not.toBeNull();
  });

  test("a schematic goal freezes the stripped text and no language", () => {
    const decl = "theorem mp (a b: wff): $ (a → b) ; a ⊢ b $;";
    const frozen = frozenTheoryText(theory, decl);

    expect(frozen.source).toBeUndefined();
    expect(proofTheoryText(frozen)).toEqual({
      mm0: `${FORALLX_THEORY_MM0}\n${decl}`,
      source: null,
    });
  });

  test("a theory that is not a language freezes the stripped text", () => {
    const frozen = frozenTheoryText(
      { mm0: GENTZEN ?? "", source: GENTZEN ?? "" },
      "theorem t: $ Γ ==> Δ $;",
    );

    expect(frozen.source).toBeUndefined();
  });

  test("a pre-#250 artifact resolves to its own text and no language", () => {
    expect(proofTheoryText({ mm0: "sort wff;" })).toEqual({
      mm0: "sort wff;",
      source: null,
    });
  });
});

describe("readNodeFormulas", () => {
  const read = proofFormulaReader(FORALLX_THEORY_SOURCE, "sentence");

  test("every node is read, and ids survive", () => {
    const root: PrawitzProofNode = {
      formula: "F(a) /\\ G(a)",
      id: "root",
      premises: [
        { formula: "F(a)", id: "l", premises: [], rule: "ax" },
        { formula: "~~G(a)", id: "r", premises: [], rule: "ax" },
      ],
      rule: "and_intro",
    };
    const { problems, root: out } = readNodeFormulas(root, read);

    expect(problems).toEqual([]);
    expect(out.formula).toBe("((F (a)) ∧ (G (a)))");
    expect(out.premises[1]?.formula).toBe("(¬ (¬ (G (a))))");
    expect(out.premises[1]?.id).toBe("r");
  });

  test("a refusal names the node that carries it, and the text passes through", () => {
    const root: PrawitzProofNode = {
      formula: "F(a) /\\",
      id: "root",
      premises: [],
      rule: "ax",
    };
    const { problems, root: out } = readNodeFormulas(root, read);

    expect(problems).toHaveLength(1);
    expect(problems[0]?.nodeId).toBe("root");
    expect(problems[0]?.formula).toBe("F(a) /\\");
    expect(out.formula).toBe("F(a) /\\");
  });

  test("a skipped node is left alone", () => {
    // A tree leaf standing for the goal's n-th hypothesis contributes `#n` and
    // emits no line, so whatever text it holds never reaches the compiler.
    const root: ProofTreeNode = {
      formula: "not a formula at all",
      hyp: 1,
      id: "h",
      premises: [],
      rule: "hyp",
    };
    const { problems, root: out } = readNodeFormulas(
      root,
      read,
      (node) => node.hyp === undefined,
    );

    expect(problems).toEqual([]);
    expect(out.formula).toBe("not a formula at all");
    expect(out.hyp).toBe(1);
  });
});

describe("the translators, reading", () => {
  test("a tree node's whole sequent is read", () => {
    const root: ProofTreeNode = {
      formula: "Ax(F(x)->G(x)) ⊢ Ax(F(x)->G(x))",
      id: "l1",
      premises: [],
      rule: "ax",
    };
    const flattened = flattenProofTree(
      root,
      "t",
      proofFormulaReader(FORALLX_THEORY_SOURCE, "sequent"),
    );

    expect(flattened.formulaProblems).toEqual([]);
    expect(flattened.proofText).toContain(
      "$ ((∀ x ((F (x)) → (G (x)))) ⊢ (∀ x ((F (x)) → (G (x))))) $",
    );
  });

  test("reading first makes a discharge mark notation-insensitive", () => {
    // Prawitz decides which leaves a mark answers to by comparing formulas as
    // strings. Unread, `~P` and `¬ P` under one mark are two formulas and the
    // translator reports `discharge_formula_mismatch`; read, they are one.
    const marked = (formula: string, id: string): PrawitzProofNode => ({
      formula,
      id,
      label: "1",
      premises: [],
      rule: "ax",
    });
    const root: PrawitzProofNode = {
      discharge: ["1"],
      formula: "~P -> (~P /\\ ~P)",
      id: "root",
      premises: [
        {
          formula: "~P /\\ ~P",
          id: "and",
          premises: [marked("~P", "a"), marked("¬ P", "b")],
          rule: "and_intro",
        },
      ],
      rule: "imp_intro",
    };

    expect(
      prawitzToAuf(root, "t", "ax", "⊢", ";").diagnostics.map(
        (one) => one.code,
      ),
    ).toEqual(["discharge_formula_mismatch"]);

    const read = prawitzToAuf(
      root,
      "t",
      "ax",
      "⊢",
      ";",
      proofFormulaReader(FORALLX_THEORY_SOURCE, "sentence"),
    );
    expect(read.formulaProblems).toEqual([]);
    expect(read.diagnostics).toEqual([]);
  });
});

describe("hasTheoryText", () => {
  // The three widgets each keep a loose structural guard over the payload they
  // hydrate from, and all three ask this. Asking it separately is how the tree
  // and Prawitz widgets went on demanding `mm0` after the compiler started
  // freezing `source` — which unhydrated every concrete forallx exercise and
  // said nothing, because an unhydrated widget is indistinguishable from one
  // whose bundle has not arrived yet.
  test("either theory text will do", () => {
    expect(hasTheoryText({ mm0: "sort wff;" })).toBe(true);
    expect(hasTheoryText({ source: "sort wff;" })).toBe(true);
  });

  test("neither is not a proof exercise's payload", () => {
    expect(hasTheoryText({ goalName: "t" })).toBe(false);
    expect(hasTheoryText(null)).toBe(false);
    expect(hasTheoryText("sort wff;")).toBe(false);
  });
});
