import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { loadCompiler } from "@aufbau/compiler";
import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import type {
  AnswerEnvelope,
  ExerciseManifestItem,
  NormalizedAnswer,
} from "../src/worker/domain/content";
import {
  proofFormulaReader,
  proofRuleReader,
  proofTheoryText,
  statementVariables,
} from "../src/worker/exercise-kit/proof/formulas";
import {
  checkPlaygroundGoal,
  isPlaygroundGoal,
  lastProofStatement,
  PLAYGROUND_GOAL_NAME,
  playgroundDeclaration,
  playgroundGoal,
  playgroundGoalText,
  playgroundTheoryText,
  verificationText,
} from "../src/worker/exercise-kit/proof/playground";
import { verifyMmb } from "../src/worker/exercise-kit/proof/verifier";
import { AUFBAU_PROOF_FITCH_EXERCISE } from "../src/worker/exercises/aufbau-proof-fitch";
import { ruleCitationShapes } from "../src/worker/exercises/aufbau-proof-fitch/citations";
import { fitchToAuf } from "../src/worker/exercises/aufbau-proof-fitch/translate";
import {
  AUFBAU_PROOF_FITCH_ANSWER_KIND,
  AUFBAU_PROOF_FITCH_SCHEMA_VERSION,
} from "../src/worker/exercises/aufbau-proof-fitch/types";
import { prawitzToAuf } from "../src/worker/exercises/aufbau-proof-prawitz/translate";
import { flattenProofTree } from "../src/worker/exercises/aufbau-proof-tree/flatten";
import { passthroughTranslator } from "../src/worker/i18n/translator";
import { theorySourceByFileName } from "../src/worker/logic/theories";
import { GENTZEN_THEORY_MM0 } from "./helpers/gentzen-theory";

/**
 * The playground (#305): a proof exercise whose goal is whatever the proof
 * proves. Three layers are pinned here. The authoring layer — `playground`
 * on each directive, the header it refuses, the header its absence still
 * demands elsewhere. The derivation — each translator's last statement, the
 * `@vars` binders it yields, the declaration those become, and the guard the
 * worker runs before splicing any of it into the theory. And the whole
 * pipeline against the real engine: the client's compile and the worker's
 * verdict, both against the theory plus the derived goal, and the review
 * that names the goal the verdict is about.
 */

const MAGNUS = theorySourceByFileName("forallx-magnus.mm0") ?? "";

/** The engine, loaded once: compiling is the client's half of the pipeline. */
const compiler = await loadCompiler({
  wasmBytes: readFileSync(
    new URL(
      "../node_modules/@aufbau/compiler/compiler.wasm",
      import.meta.url,
    ),
  ),
});

const MAGNUS_BLOCK = `:::aufbau-mm0{name="fx" src="/theories/forallx-magnus.mm0"}\n:::`;

async function compileOne(directive: string): Promise<ExerciseManifestItem> {
  const compiled = await compileCarnapMarkdown(
    `${MAGNUS_BLOCK}\n\n${directive}`,
  );
  if (!compiled.ok) {
    throw new Error(
      `compile failed: ${compiled.diagnostics.map((d) => d.code).join(", ")}`,
    );
  }
  const item = compiled.artifact.manifest[0];
  if (item === undefined) {
    throw new Error("no exercise compiled");
  }
  return item;
}

async function diagnosticCodes(source: string): Promise<string[]> {
  const compiled = await compileCarnapMarkdown(
    `${MAGNUS_BLOCK}\n\n${source}`,
  );
  return compiled.ok ? [] : compiled.diagnostics.map((d) => d.code);
}

/** A Magnus Fitch proof translated as the playground widget translates it. */
function translateMagnus(fitch: string): ReturnType<typeof fitchToAuf> {
  return fitchToAuf(
    fitch,
    PLAYGROUND_GOAL_NAME,
    "AS",
    "⊢",
    ";",
    proofFormulaReader(MAGNUS, "sentence", PLAYGROUND_GOAL_NAME),
    ruleCitationShapes(MAGNUS),
    proofRuleReader(MAGNUS),
  );
}

const QUANTIFIER_PROOF = [
  "∀x(Fx → Gx)  :AS",
  "Fa           :AS",
  "Fa → Ga      :∀E 1",
  "Ga           :→E 3 2",
].join("\n");

describe("playground authoring", () => {
  test("each proof directive takes `playground` in place of a goal header", async () => {
    const fitch = await compileOne(
      `:::aufbau-proof-fitch{system="fx" id="f" playground}\nTry anything.\n----\nP → Q  :AS\n:::`,
    );
    expect(fitch.publicData).toMatchObject({
      goalName: PLAYGROUND_GOAL_NAME,
      playground: true,
      starterBody: "P → Q  :AS",
    });
    expect(fitch.publicData).not.toHaveProperty("goalDecl");
    // The join appends nothing: the text is the theory's alone.
    expect(
      proofTheoryText(fitch.publicData as { source?: string }).mm0,
    ).not.toContain("theorem playground");

    const tree = await compileOne(
      `:::aufbau-proof-tree{system="fx" id="t" playground}\nBuild a tree.\n:::`,
    );
    expect(tree.publicData).toMatchObject({
      goalFormula: "",
      goalName: PLAYGROUND_GOAL_NAME,
      playground: true,
    });

    const prawitz = await compileOne(
      `:::aufbau-proof-prawitz{system="fx" id="z" playground}\nBuild a derivation.\n:::`,
    );
    expect(prawitz.publicData).toMatchObject({
      goalFormula: "",
      playground: true,
    });

    const linear = await compileOne(
      `:::aufbau-proof{system="fx" id="l" playground}\nWrite \`.auf\`.\n----\nl1: $ _ ⊢ (P (snil)) → (P (snil)) $ by sorry!\n:::`,
    );
    expect(linear.publicData).toMatchObject({
      goalName: PLAYGROUND_GOAL_NAME,
      playground: true,
      starterBody: "l1: $ _ ⊢ (P (snil)) → (P (snil)) $ by sorry!",
    });
  });

  test("the prompt is everything above the underline, and the underline is optional", async () => {
    const withStarter = await compileOne(
      `:::aufbau-proof-fitch{system="fx" id="f" playground}\nSome *prose*.\n\nMore.\n----\nP  :AS\n:::`,
    );
    expect(withStarter.publicData).toMatchObject({
      promptHtml: expect.stringContaining("<em>prose</em>"),
      starterBody: "P  :AS",
    });

    const bare = await compileOne(
      `:::aufbau-proof-fitch{system="fx" id="f" playground}\nJust prose.\n:::`,
    );
    expect(bare.publicData).toMatchObject({ starterBody: "" });
  });

  test("a playground with a goal header is refused, and a header-less exercise is not a playground", async () => {
    expect(
      await diagnosticCodes(
        `:::aufbau-proof-fitch{system="fx" id="f" playground}\ntheorem t: $ P ⊢ P $\n----\nP :AS\n:::`,
      ),
    ).toContain("playground_declares_goal");

    // The converse: dropping the header without saying `playground` is still
    // the mistake it always was, so a typo'd header cannot silently become one.
    expect(
      await diagnosticCodes(
        `:::aufbau-proof-fitch{system="fx" id="f"}\nNo header here.\n----\nP :AS\n:::`,
      ),
    ).toContain("missing_theorem_header");
    expect(
      await diagnosticCodes(
        `:::aufbau-proof-tree{system="fx" id="t"}\nNo header here.\n:::`,
      ),
    ).toContain("missing_theorem_header");
  });

  test("a starter is read in the theory's language, with no goal in scope", async () => {
    expect(
      await diagnosticCodes(
        `:::aufbau-proof-fitch{system="fx" id="f" playground}\n----\nP ∧  :AS\n:::`,
      ),
    ).toContain("invalid_formula");
  });
});

describe("deriving the goal", () => {
  test("the Fitch translator's statement is the last line with its ambient context, and its variables", () => {
    const { statement } = translateMagnus(QUANTIFIER_PROOF);

    expect(statement).toEqual({
      text: "(∀ x ((F (x)) → (G (x)))) ; F (a) ⊢ G (a)",
      variables: [
        { name: "x", sort: "var" },
        { name: "a", sort: "name" },
      ],
    });
    expect(translateMagnus("").statement).toBeNull();
  });

  test("the binders are the statement's `@vars` tokens, each a curly binder at its pool sort", () => {
    const { statement } = translateMagnus(QUANTIFIER_PROOF);
    const goal = playgroundGoal(
      MAGNUS,
      statement as NonNullable<typeof statement>,
    );

    expect(goal).toEqual({
      binders: [
        { name: "x", sort: "var" },
        { name: "a", sort: "name" },
      ],
      statement: "(∀ x ((F (x)) → (G (x)))) ; F (a) ⊢ G (a)",
    });
    expect(playgroundDeclaration(goal as NonNullable<typeof goal>)).toBe(
      "theorem playground {x: var} {a: name}: $ (∀ x ((F (x)) → (G (x)))) ; F (a) ⊢ G (a) $;",
    );
  });

  test("a sentential statement binds nothing: sentence letters are terms", () => {
    const { statement } = translateMagnus("P → Q  :AS\nP  :AS\nQ  :→E 1 2");
    const goal = playgroundGoal(
      MAGNUS,
      statement as NonNullable<typeof statement>,
    );

    expect(goal).toEqual({
      binders: [],
      statement: "((P (snil)) → (Q (snil))) ; P (snil) ⊢ Q (snil)",
    });
  });

  test("the tree's statement is the root, the Prawitz statement the root with its open assumptions", () => {
    const read = proofFormulaReader(MAGNUS, "sequent", PLAYGROUND_GOAL_NAME);
    const tree = flattenProofTree(
      {
        formula: "Fa ⊢ Fa",
        id: "r",
        premises: [],
        rule: "AS",
      },
      PLAYGROUND_GOAL_NAME,
      read,
      proofRuleReader(MAGNUS),
    );
    expect(tree.statement).toEqual({
      text: "((F (a)) ⊢ (F (a)))",
      variables: [{ name: "a", sort: "name" }],
    });

    const prawitz = prawitzToAuf(
      {
        formula: "Fa ∧ Gb",
        id: "r",
        premises: [
          { formula: "Fa", id: "a", premises: [], rule: "AS" },
          { formula: "Gb", id: "b", premises: [], rule: "AS" },
        ],
        rule: "∧I",
      },
      PLAYGROUND_GOAL_NAME,
      "AS",
      "⊢",
      ";",
      proofFormulaReader(MAGNUS, "sentence", PLAYGROUND_GOAL_NAME),
      proofRuleReader(MAGNUS),
    );
    expect(prawitz.statement).toEqual({
      text: "F (a) ; G (b) ⊢ ((F (a)) & (G (b)))",
      variables: [
        { name: "a", sort: "name" },
        { name: "b", sort: "name" },
      ],
    });
  });

  test("a theory that reads nothing still yields binders, from the statement alone", () => {
    // `gentzen-lk` names no sort for its lines (#274), so the tree passes
    // them through as engine text and the reading has no variables to offer.
    // The statement is then read once, at the theory's one provable sort,
    // and the `@vars` tokens it holds are what get bound.
    const flattened = flattenProofTree(
      {
        formula: "P z , Q w ==> P z",
        id: "r",
        premises: [
          { formula: "P z ==> P z", id: "a", premises: [], rule: "ax" },
        ],
        rule: "weak_left",
      },
      PLAYGROUND_GOAL_NAME,
    );
    expect(flattened.statement).toEqual({
      text: "P z , Q w ==> P z",
      variables: null,
    });
    expect(
      statementVariables(GENTZEN_THEORY_MM0, "P z , Q w ==> P z"),
    ).toEqual([
      { name: "z", sort: "obj" },
      { name: "w", sort: "obj" },
    ]);
    expect(
      playgroundGoal(
        GENTZEN_THEORY_MM0,
        flattened.statement as NonNullable<typeof flattened.statement>,
      ),
    ).toEqual({
      binders: [
        { name: "z", sort: "obj" },
        { name: "w", sort: "obj" },
      ],
      statement: "P z , Q w ==> P z",
    });
    // And a statement that will not read yields no goal, rather than a wrong one.
    expect(
      playgroundGoal(GENTZEN_THEORY_MM0, {
        text: "not a sequent",
        variables: null,
      }),
    ).toBeNull();
  });

  test("the goal is shown in the theory's display spelling, the sequent spaced", () => {
    expect(
      playgroundGoalText(MAGNUS, {
        binders: [
          { name: "x", sort: "var" },
          { name: "a", sort: "name" },
        ],
        statement: "(∀ x ((F (x)) → (G (x)))) ; F (a) ⊢ G (a)",
      }),
    ).toBe("∀x(Fx → Gx); Fa ⊢ Ga");
    expect(
      playgroundGoalText(MAGNUS, {
        binders: [],
        statement: "_ ⊢ (P (snil)) → (P (snil))",
      }),
    ).toBe("⊢ P → P");
    // A theory with no display conventions shows the statement as typed.
    expect(
      playgroundGoalText(GENTZEN_THEORY_MM0, {
        binders: [{ name: "z", sort: "obj" }],
        statement: "P z ==> P z",
      }),
    ).toBe("P z ==> P z");
  });

  test("the linear widget takes the last `.auf` line's math string", () => {
    expect(
      lastProofStatement(
        "l1: $ _ ⊢ P $ by AS []\nl2: $ _ ⊢ P → P $ by →I [l1]\n\n",
      ),
    ).toBe("_ ⊢ P → P");
    expect(lastProofStatement("-- nothing yet")).toBeNull();
  });
});

describe("the worker's guard on a submitted goal", () => {
  const good = {
    binders: [
      { name: "x", sort: "var" },
      { name: "a", sort: "name" },
    ],
    statement: "(∀ x ((F (x)) → (G (x)))) ; F (a) ⊢ G (a)",
  };

  test("accepts a goal whose binders are pool tokens at their pool sorts", () => {
    expect(checkPlaygroundGoal(MAGNUS, good)).toBeNull();
    expect(isPlaygroundGoal(good)).toBe(true);
    expect(isPlaygroundGoal({ binders: "x", statement: "" })).toBe(false);
  });

  test("refuses a binder the theory's pools do not vouch for", () => {
    // `P` is a term, and binding it as a wff would shadow the lexicon —
    // exactly what the restriction to `@vars` exists to rule out.
    expect(
      checkPlaygroundGoal(MAGNUS, {
        ...good,
        binders: [{ name: "P", sort: "wff" }],
      }),
    ).toBe("binder_not_in_pool");
    // A pool token at the wrong sort is no better.
    expect(
      checkPlaygroundGoal(MAGNUS, {
        ...good,
        binders: [{ name: "x", sort: "name" }],
      }),
    ).toBe("binder_not_in_pool");
    expect(
      checkPlaygroundGoal(MAGNUS, {
        ...good,
        binders: [
          { name: "x", sort: "var" },
          { name: "x", sort: "var" },
        ],
      }),
    ).toBe("duplicate_binder");
  });

  test("refuses a statement that could leave its math string", () => {
    expect(
      checkPlaygroundGoal(MAGNUS, {
        binders: [],
        statement: "_ ⊢ P (snil) $; axiom anything (p: wff): $ _ ⊢ p",
      }),
    ).toBe("statement_escapes");
    expect(
      checkPlaygroundGoal(MAGNUS, {
        binders: [],
        statement: "_ ⊢ P (snil)\n",
      }),
    ).toBe("statement_escapes");
    expect(
      checkPlaygroundGoal(MAGNUS, {
        binders: [],
        statement: "x".repeat(9_000),
      }),
    ).toBe("statement_too_long");
    expect(checkPlaygroundGoal(null, good)).toBe("theory_unreadable");
  });

  test("an ordinary exercise verifies against its frozen text, a playground against the answer's goal", () => {
    const ordinary = verificationText(
      { source: `${MAGNUS}\ntheorem t: $ _ ⊢ P (snil) $;` },
      {},
    );
    expect(ordinary).toMatchObject({ ok: true });
    expect((ordinary as { mm0: string }).mm0).toContain("theorem t:");

    expect(
      verificationText({ playground: true, source: MAGNUS }, {}),
    ).toEqual({
      ok: false,
      problem: "missing_goal",
    });
    const playground = verificationText(
      { playground: true, source: MAGNUS },
      { goal: good },
    );
    expect(playground).toMatchObject({ ok: true });
    expect((playground as { mm0: string }).mm0).toEndWith(
      playgroundDeclaration(good),
    );
  });
});

describe("the pipeline against the engine", () => {
  const type = AUFBAU_PROOF_FITCH_EXERCISE;

  async function declaration(): Promise<ExerciseManifestItem> {
    return compileOne(
      `:::aufbau-proof-fitch{system="fx" id="pg" playground points="1"}\nProve anything.\n:::`,
    );
  }

  /** What the widget submits: the translation, its goal, and the certificate. */
  function submit(fitch: string): {
    readonly envelope: AnswerEnvelope;
    readonly goal: NonNullable<ReturnType<typeof playgroundGoal>>;
    readonly mmb: Uint8Array;
  } {
    const translation = translateMagnus(fitch);
    const goal = playgroundGoal(
      MAGNUS,
      translation.statement as NonNullable<typeof translation.statement>,
    );
    if (goal === null) {
      throw new Error("no goal derived");
    }
    const theory = playgroundTheoryText(
      proofTheoryText({ source: MAGNUS }),
      goal,
    );
    const result = compiler.compile(theory.mm0, translation.proofText);
    if (result.ok !== true || result.mmbBytes === undefined) {
      throw new Error(
        `compile failed: ${JSON.stringify(result.diagnostics)}`,
      );
    }
    return {
      envelope: {
        data: {
          fitchText: fitch,
          goal,
          mmb: btoa(String.fromCharCode(...result.mmbBytes)),
          proofText: translation.proofText,
        } as unknown as AnswerEnvelope["data"],
        kind: AUFBAU_PROOF_FITCH_ANSWER_KIND,
        schemaVersion: AUFBAU_PROOF_FITCH_SCHEMA_VERSION,
      },
      goal,
      mmb: result.mmbBytes,
    };
  }

  test("the derived declaration compiles and verifies, with quantifiers and names bound", async () => {
    const { goal, mmb } = submit(QUANTIFIER_PROOF);
    const theory = playgroundTheoryText(
      proofTheoryText({ source: MAGNUS }),
      goal,
    );

    expect(await verifyMmb(theory.mm0, mmb)).toEqual({
      errored: false,
      ok: true,
    });
    // The certificate is about *this* statement: against another it is nothing.
    const other = playgroundTheoryText(proofTheoryText({ source: MAGNUS }), {
      binders: [{ name: "a", sort: "name" }],
      statement: "_ ⊢ F (a)",
    });
    expect((await verifyMmb(other.mm0, mmb)).ok).toBe(false);
  });

  test("the worker grades a playground submission against the goal it carries", async () => {
    const item = await declaration();
    const { envelope } = submit(QUANTIFIER_PROOF);
    const normalized = type.normalizeAnswer(envelope, item);

    expect(normalized.ok).toBe(true);
    if (!normalized.ok) {
      return;
    }
    // The goal is kept with the answer — it is what the verdict is about —
    // and the certificate is read beside it, as ever.
    expect(normalized.answer.data).toMatchObject({
      goal: {
        binders: [
          { name: "x", sort: "var" },
          { name: "a", sort: "name" },
        ],
      },
    });
    expect(normalized.answer.data).not.toHaveProperty("mmb");

    const evaluation = await type.evaluate(normalized.answer, item, {
      certificate: normalized.certificate as Uint8Array,
      now: "1970-01-01T00:00:00.000Z",
    });
    expect(evaluation.status).toBe("correct");
    expect(evaluation.awardedScore).toBe(1);

    const review = type.reviewAnswer(normalized.answer, item, {
      audience: "student",
      i18n: passthroughTranslator,
    });
    expect(review.details).toEqual([
      { label: "Goal", value: "∀x(Fx → Gx); Fa ⊢ Ga" },
    ]);
  });

  test("a playground answer without a goal is malformed; a goal the theory cannot vouch for is invalid", async () => {
    const item = await declaration();
    const { envelope } = submit(QUANTIFIER_PROOF);
    const { goal: _goal, ...withoutGoal } = envelope.data as Record<
      string,
      unknown
    >;

    expect(
      type.normalizeAnswer(
        { ...envelope, data: withoutGoal as AnswerEnvelope["data"] },
        item,
      ),
    ).toMatchObject({ ok: false, reason: "malformed" });

    // A client that lied about its binders: the guard refuses before the
    // engine ever sees the text, and the verdict is `invalid`, not a score.
    const forged: NormalizedAnswer = {
      data: {
        fitchText: QUANTIFIER_PROOF,
        goal: { binders: [{ name: "F", sort: "wff" }], statement: "_ ⊢ F" },
        proofText: "",
      } as unknown as NormalizedAnswer["data"],
      kind: AUFBAU_PROOF_FITCH_ANSWER_KIND,
      schemaVersion: AUFBAU_PROOF_FITCH_SCHEMA_VERSION,
    };
    const evaluation = await type.evaluate(forged, item, {
      certificate: new Uint8Array([1, 2, 3]),
      now: "1970-01-01T00:00:00.000Z",
    });
    expect(evaluation.status).toBe("invalid");
    expect(evaluation.awardedScore).toBe(0);
    expect(evaluation.feedback).toEqual({
      diagnostics: [{ code: "playground_binder_not_in_pool" }],
    });
  });

  test("a certificate for one statement does not score against another", async () => {
    const item = await declaration();
    const { envelope } = submit(QUANTIFIER_PROOF);
    const swapped = {
      ...envelope,
      data: {
        ...(envelope.data as Record<string, unknown>),
        goal: {
          binders: [{ name: "a", sort: "name" }],
          statement: "_ ⊢ F (a)",
        },
      } as AnswerEnvelope["data"],
    };
    const normalized = type.normalizeAnswer(swapped, item);
    if (!normalized.ok) {
      throw new Error("expected a well-formed answer");
    }
    const evaluation = await type.evaluate(normalized.answer, item, {
      certificate: normalized.certificate as Uint8Array,
      now: "1970-01-01T00:00:00.000Z",
    });
    expect(evaluation.status).toBe("incorrect");
  });
});
