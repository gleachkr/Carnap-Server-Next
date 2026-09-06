import { describe, expect, test } from "bun:test";

import type { ProofFormulaShape } from "../src/worker/exercises/aufbau-proof/formulas";
import {
  ENGINE_TEXT,
  goalBinderScope,
  goalBinderShadows,
  goalStatementText,
  hasTheoryText,
  proofFormulaReader,
  proofTheoryText,
  readNodeFormulas,
} from "../src/worker/exercises/aufbau-proof/formulas";
import { prawitzToAuf } from "../src/worker/exercises/aufbau-proof-prawitz/translate";
import type { PrawitzProofNode } from "../src/worker/exercises/aufbau-proof-prawitz/types";
import { flattenProofTree } from "../src/worker/exercises/aufbau-proof-tree/flatten";
import type { ProofTreeNode } from "../src/worker/exercises/aufbau-proof-tree/types";
import { withSystemText } from "../src/worker/exercises/systems";
import { theorySourceByFileName } from "../src/worker/logic/theories";
import { FORALLX_CASES } from "./helpers/forallx-cases";
import {
  FORALLX_THEORY_MM0,
  FORALLX_THEORY_SOURCE,
} from "./helpers/forallx-theory";

/**
 * Reading a proof's formulas in the theory's own language (#250), in the
 * scope of the goal's own binders (#253).
 *
 * The end-to-end claim — that what comes out is text the real Aufbau compiler
 * accepts and the verifier verifies — is `scripts/{forallx,prawitz}-verify.ts`,
 * which compile from source each run. What is pinned here is everything that
 * decides *how* a formula is read, because that is where being wrong is
 * silent: the failure the scope exists to stop is not a refusal but a line
 * that parses against the wrong vocabulary and means something else.
 */

const GENTZEN = theorySourceByFileName("gentzen-lk.mm0");

const CONCRETE =
  "theorem t {x: var} {a: name}: $ ∀ x (F(x) → G(x)) ⊢ G(a) $;";

/** The schematic shape 12 of the 19 forallx rule cases are stated in. */
const SCHEMATIC = "theorem mp (a b: wff): $ (a → b) ; a ⊢ b $;";

const THEORY = { mm0: FORALLX_THEORY_MM0, source: FORALLX_THEORY_SOURCE };

/**
 * The two texts one exercise over a theory ends up with, assembled the way the
 * compiler and the join assemble them: the theory becomes a table entry, and
 * the exercise's own declaration is appended when the two meet.
 */
function frozenFor(
  theory: { readonly mm0: string; readonly source: string },
  theoremDecl: string,
): { readonly mm0?: string; readonly source?: string } {
  return withSystemText(
    { goalDecl: theoremDecl, system: "t" },
    { t: theory.source },
  ) as { readonly mm0?: string; readonly source?: string };
}

/**
 * A reader for one goal over the forallx theory, assembled the way the
 * authoring compiler assembles it — so a test cannot read a formula in a
 * scope no exercise would actually have.
 */
function readerFor(
  goalName: string,
  theoremDecl: string,
  shape: ProofFormulaShape = "sentence",
) {
  const { source } = proofTheoryText(frozenFor(THEORY, theoremDecl));

  return proofFormulaReader(source, shape, goalName);
}

describe("proofFormulaReader", () => {
  const read = readerFor("t", CONCRETE);

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
    const sequent = readerFor("t", CONCRETE, "sequent");

    expect(sequent("Ax(F(x)->G(x)) ; F(a) ⊢ G(a)")).toEqual({
      ok: true,
      text: "(((∀ x ((F (x)) → (G (x)))) ; (F (a))) ⊢ (G (a)))",
    });
    expect(read("Ax(F(x)->G(x)) ; F(a) ⊢ G(a)").ok).toBe(false);
  });

  test("a theory that names no sort to read at passes everything through", () => {
    // `gentzen-lk` declares no `@syntax` at all, so it names neither a
    // sentence sort nor a turnstile role, and nothing here is willing to guess
    // one. It is a perfectly good language otherwise — its own notations read
    // fine — which is why the gate is on the sort and not on language-hood
    // (#274). This is the whole behavioural claim of that change: the set of
    // theories that pass through is exactly the set that passed through before.
    const gentzen = proofFormulaReader(GENTZEN, "sequent", "t");

    expect(gentzen("Γ ==> Δ")).toEqual({ ok: true, text: "Γ ==> Δ" });
    expect(gentzen("this is not a formula")).toEqual({
      ok: true,
      text: "this is not a formula",
    });
  });

  test("no source at all is the same pass-through", () => {
    // What a pre-#250 artifact hands over: it froze the stripped engine text
    // and nothing else, so there is no language to read it in.
    expect(proofFormulaReader(null, "sentence", "t")).toBe(ENGINE_TEXT);
    expect(proofFormulaReader(undefined, "sentence", "t")).toBe(ENGINE_TEXT);
  });
});

describe("goalBinderScope", () => {
  const scopeOf = (theoremDecl: string, goalName: string) =>
    goalBinderScope(`${FORALLX_THEORY_SOURCE}\n${theoremDecl}`, goalName);

  test("a binder group is one entry per name", () => {
    // `(a b: wff)` is two binders, not one — the shape a regular expression
    // over the declaration text got wrong, and the spec reader gets right.
    expect(scopeOf(SCHEMATIC, "mp")).toEqual(
      new Map([
        ["a", "wff"],
        ["b", "wff"],
      ]),
    );
  });

  test("bound binders count too, at their own sort", () => {
    expect(scopeOf(CONCRETE, "t")).toEqual(
      new Map([
        ["x", "var"],
        ["a", "name"],
      ]),
    );
  });

  test("a hypothesis binder introduces no vocabulary", () => {
    // `(h: $ … $)` names a hypothesis, and carries a formula where the others
    // carry a type. It is in the binder list and not in the scope.
    expect(
      scopeOf("theorem h {a: name} (h: $ F(a) $): $ _ ⊢ F(a) $;", "h"),
    ).toEqual(new Map([["a", "name"]]));
  });

  test("a dependent sort contributes its head", () => {
    expect(
      scopeOf("theorem d {x: var} (p: wff x): $ _ ⊢ ∀ x p $;", "d"),
    ).toEqual(
      new Map([
        ["x", "var"],
        ["p", "wff"],
      ]),
    );
  });

  test("a goal with no binders has an empty scope", () => {
    expect(scopeOf("theorem c: $ _ ⊢ F(a) → F(a) $;", "c")).toEqual(
      new Map(),
    );
  });

  test("a theory that names no sentence sort still has binders", () => {
    // The scope is read off the *declaration*, which is MM0's own grammar and
    // not a question about notation, so it is populated here even though no
    // formula of this theory will be parsed in it (#274). Nothing downstream
    // is misled by that: the scope only ever reaches `language.parse`, and
    // `proofFormulaReader` has already returned the pass-through above.
    expect(
      goalBinderScope(`${GENTZEN}\ntheorem t (a b: wff): $ a ⊢ b $;`, "t"),
    ).toEqual(
      new Map([
        ["a", "wff"],
        ["b", "wff"],
      ]),
    );
  });

  test("every worked forallx case names a goal the scope can find", () => {
    // The failure mode this guards is silent: a goal name that does not match
    // yields an empty scope, which is exactly the pre-#253 behaviour. Every
    // case in the corpus binds something, so an empty scope means a miss.
    for (const testCase of FORALLX_CASES) {
      expect(
        scopeOf(testCase.theoremDecl, testCase.goalName).size,
        testCase.name,
      ).toBeGreaterThan(0);
    }
  });
});

/**
 * What the Fitch widget puts in its "Prove" row, and what a review names as
 * the goal. A declaration is how a goal is stored; this is how it is asked.
 */
describe("goalStatementText", () => {
  const statementOf = (theoremDecl: string, goalName: string) =>
    goalStatementText(`${FORALLX_THEORY_SOURCE}\n${theoremDecl}`, goalName);

  test("the theorem's name and binders are not part of the question", () => {
    expect(statementOf(SCHEMATIC, "mp")).toBe("(a → b) ; a ⊢ b");
  });

  test("a bound-variable binder goes too", () => {
    // `{x: var}` is what makes `∀ x` legal; it says nothing to a student.
    expect(statementOf(CONCRETE, "t")).toBe("∀ x (F(x) → G(x)) ⊢ G(a)");
  });

  test("a hypothesis binder is not mistaken for the statement", () => {
    // The case that decides this is read from the parsed statement rather
    // than cut at the declaration's first `$`: here that `$` opens `(h: $ F(a)
    // $)`, a binder, and the statement is the one after it.
    expect(
      statementOf("theorem h {a: name} (h: $ F(a) $): $ _ ⊢ F(a) $;", "h"),
    ).toBe("_ ⊢ F(a)");
  });

  test("a `>`-chain keeps its hypotheses", () => {
    expect(
      statementOf("theorem g (a b: wff): $ _ ⊢ a $ > $ _ ⊢ b $;", "g"),
    ).toBe("_ ⊢ a > _ ⊢ b");
  });

  test("a theory that names no sentence sort still has a declaration", () => {
    // Naming a sentence sort decides whether a *formula* is read; a
    // declaration splits by MM0's own grammar, which `gentzen-lk` obeys like
    // any other file. The statement comes back as engine text, because that is
    // what it was — what comes off is the name, the binders and the `$ … $`.
    expect(
      goalStatementText(
        `${GENTZEN}\ntheorem t (a b: wff): $ a ==> b $;`,
        "t",
      ),
    ).toBe("a ==> b");
  });

  test("a goal the source does not declare is null, not empty", () => {
    expect(statementOf(SCHEMATIC, "not_the_goal")).toBeNull();
  });
});

describe("goalBinderShadows", () => {
  const shadowsOf = (theoremDecl: string, goalName: string) =>
    goalBinderShadows(`${FORALLX_THEORY_SOURCE}\n${theoremDecl}`, goalName);

  test("a binder over a lexicon variable of another sort", () => {
    // `a` is a name in this theory (`@vars a b c d e` at sort `name`) and a
    // sentence metavariable here — the shape 12 of the 19 rule cases take.
    expect(shadowsOf(SCHEMATIC, "mp")).toEqual([
      { displacedSort: "name", kind: "variable", name: "a", sort: "wff" },
      { displacedSort: "name", kind: "variable", name: "b", sort: "wff" },
    ]);
  });

  test("a binder over a declared term", () => {
    // The case Graham raised against the old provable-sort gate: nothing
    // about `tm` makes `f` safer than `P`.
    expect(shadowsOf("theorem fc (f: tm): $ _ ⊢ f = f $;", "fc")).toEqual([
      { kind: "term", name: "f", sort: "tm" },
    ]);
  });

  test("a binder over a spelling outranks its lexicon reading", () => {
    // `A` is at once a predicate letter and the elab literal that spells ∀.
    // One warning per binder, and this is the one worth saying: the lexicon
    // collision costs nothing a student can see, the lost spelling does.
    expect(shadowsOf("theorem el (A: wff): $ A ⊢ A $;", "el")).toEqual([
      { kind: "notation", name: "A", sort: "wff" },
    ]);
  });

  test("rebinding a name to the reading it already had is not shadowing", () => {
    // Every first-order goal must bind the variables it quantifies over, and
    // `{x: var}` over an `s`–`z` pool displaces nothing. Warning here would
    // report something no author can avoid, on every FOL exercise there is.
    expect(shadowsOf(CONCRETE, "t")).toEqual([]);
  });

  test("a theory that names no sentence sort has a vocabulary all the same", () => {
    // `a` and `b` are nothing in `gentzen-lk`, so binding them displaces
    // nothing — but `P` is a term it declares and spells, and rebinding that
    // does cost the author the spelling for the length of the exercise. The
    // warning is honest over any theory whose text reads, which is why it is
    // no longer skipped for the ones that name no sentence sort (#274).
    const shadowsOfGentzen = (theoremDecl: string) =>
      goalBinderShadows(`${GENTZEN}\n${theoremDecl}`, "t");

    expect(shadowsOfGentzen("theorem t (a b: wff): $ a ⊢ b $;")).toEqual([]);
    expect(shadowsOfGentzen("theorem t (P: wff): $ P ⊢ P $;")).toEqual([
      { kind: "notation", name: "P", sort: "wff" },
    ]);
  });

  test("the whole forallx corpus, split by whether it shadows", () => {
    // Pinned as a set so the warning's reach is visible: if a change makes it
    // fire on the FOL cases, that shows up here rather than as noise in the
    // author's editor.
    const noisy = FORALLX_CASES.filter(
      (one) => shadowsOf(one.theoremDecl, one.goalName).length > 0,
    ).map((one) => one.goalName);

    expect(noisy).toEqual([
      "self",
      "aliased",
      "mp",
      "reittest",
      "andcomm",
      "orcomm",
      "exfalso",
      "biconelim",
      "andcommbicon",
      "dni",
      "dne",
      "vacuous",
      "nested",
      "funcoll",
      "schemdm",
    ]);
  });
});

describe("a schematic goal reads in its own binders", () => {
  const read = readerFor("mp", SCHEMATIC);

  test("a metavariable is not the lexicon letter it collides with", () => {
    // `a` is a name in this theory's lexicon and a wff metavariable in this
    // goal. Before #253 this exercise was frozen without a language so the
    // line passed through untouched; now it is read, and read correctly.
    expect(read("a → b")).toEqual({ ok: true, text: "(a → b)" });
  });

  test("textbook notation works in a schematic goal too", () => {
    // The point of the whole feature, previously unavailable to 12 of the 19
    // rule cases: the student may write the book's spelling.
    expect(read("~(a /\\ b)")).toEqual({ ok: true, text: "(¬ (a ∧ b))" });
  });

  test("a metavariable takes no arguments", () => {
    // The shadowing is total: `a` is not the predicate letter any more, so
    // applying it is a refusal rather than a silently different reading.
    expect(read("a(b)").ok).toBe(false);
  });

  test("a name the goal does not bind still reads from the lexicon", () => {
    // `c` is not among this goal's binders, so it is the lexicon's name — and
    // the scope shadows only what it holds, never the whole vocabulary.
    expect(read("F(c) → a")).toEqual({ ok: true, text: "((F (c)) → a)" });
  });

  test("shadowing is total, so a metavariable cannot take an argument", () => {
    // The mirror of the case above: `a` is bound, so `F(a)` wants a term and
    // is handed a sentence. A refusal, not a different reading.
    expect(read("F(a)").ok).toBe(false);
  });
});

describe("the systems table's text", () => {
  const theory = THEORY;

  test("a concrete goal joins onto the artifact as written", () => {
    const frozen = frozenFor(theory, CONCRETE);

    expect(frozen.source).toBe(`${FORALLX_THEORY_SOURCE}\n${CONCRETE}`);
  });

  test("stripping the joined source gives back the engine input exactly", () => {
    // The two texts differ by whole `@syntax` lines and nothing else, which is
    // what lets only one of them be tabled: a certificate is still verified
    // against `${theory}\n${goal}`, byte for byte.
    const resolved = proofTheoryText(frozenFor(theory, CONCRETE));

    expect(resolved.mm0).toBe(`${FORALLX_THEORY_MM0}\n${CONCRETE}`);
    expect(resolved.source).not.toBeNull();
  });

  test("a schematic goal joins onto the artifact as written too", () => {
    // Before #253 this froze the stripped text and no language, turning the
    // feature off for every goal stated as a rule schema. The binder scope is
    // what made that unnecessary.
    expect(proofTheoryText(frozenFor(theory, SCHEMATIC))).toEqual({
      mm0: `${FORALLX_THEORY_MM0}\n${SCHEMATIC}`,
      source: `${FORALLX_THEORY_SOURCE}\n${SCHEMATIC}`,
    });
  });

  test("a theory that is no language costs the duplicate and nothing else", () => {
    // `gentzen-lk` carries no `@syntax` at all, which used to put it on the
    // table's second arm — the one that stored the stripped text and told a
    // reader there was no language here. Both texts now arrive, and for a file
    // with nothing to strip they are the same bytes; what makes that safe is
    // that no reader trusts the field's absence. `proofLanguage` asks the spec
    // for a sentence sort and this one names none, so its lines are engine text
    // exactly as before.
    const gentzen = { mm0: GENTZEN ?? "", source: GENTZEN ?? "" };
    const frozen = frozenFor(gentzen, "theorem t: $ Γ ==> Δ $;");

    expect(frozen.source).toBe(frozen.mm0);
    expect(proofFormulaReader(frozen.source ?? null, "sentence", "t")).toBe(
      ENGINE_TEXT,
    );
  });

  test("a pre-#250 artifact resolves to its own text and no language", () => {
    expect(proofTheoryText({ mm0: "sort wff;" })).toEqual({
      mm0: "sort wff;",
      source: null,
    });
  });
});

describe("readNodeFormulas", () => {
  const read = readerFor("t", CONCRETE);

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
      readerFor("t", CONCRETE, "sequent"),
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
      readerFor("t", CONCRETE),
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
