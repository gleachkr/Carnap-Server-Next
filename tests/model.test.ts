import { describe, expect, test } from "bun:test";
import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import {
  MODEL_ANSWER_KIND,
  MODEL_KIND,
  MODEL_SCHEMA_VERSION,
  ModelExerciseHandler,
} from "../src/worker/application/content/registry";
import { renderCompiledContent } from "../src/worker/application/content/renderer";
import type {
  CompiledContentArtifact,
  ExerciseManifestItem,
} from "../src/worker/domain/content";
import {
  effectiveAnswer,
  resolveModel,
} from "../src/worker/exercises/model/grading";
import {
  modelGoalText,
  renderModelReview,
} from "../src/worker/exercises/model/read-only-view";
import type {
  ModelAnswerData,
  ModelCheckMode,
  ModelPublicData,
} from "../src/worker/exercises/model/types";
import { i18nFor } from "../src/worker/i18n";
import { passthroughTranslator } from "../src/worker/i18n/translator";

const REVIEW_CONTEXT = {
  audience: "student",
  i18n: passthroughTranslator,
} as const;

function directive(attrs: string, body: string): string {
  return `::::model{${attrs}}\n${body}\n::::`;
}

async function compileArtifact(
  source: string,
): Promise<CompiledContentArtifact> {
  const result = await compileCarnapMarkdown(source);

  if (!result.ok) {
    throw new Error(
      `compile failed: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
  }

  return result.artifact;
}

async function compileCodes(source: string): Promise<string[]> {
  const result = await compileCarnapMarkdown(source);
  return result.ok ? [] : result.diagnostics.map((d) => d.code);
}

async function declaration(source: string): Promise<ExerciseManifestItem> {
  const artifact = await compileArtifact(source);
  return artifact.manifest[0] as ExerciseManifestItem;
}

function publicDataOf(item: ExerciseManifestItem): ModelPublicData {
  return item.publicData as unknown as ModelPublicData;
}

function envelope(data: ModelAnswerData) {
  return {
    data: data as unknown as Record<string, unknown>,
    kind: MODEL_ANSWER_KIND,
    schemaVersion: MODEL_SCHEMA_VERSION,
  };
}

const handler = new ModelExerciseHandler();

async function score(
  source: string,
  answer: ModelAnswerData,
): Promise<{ score: number; status: string }> {
  const item = await declaration(source);
  const evaluation = await handler.evaluate(
    {
      data: answer as unknown as Record<string, unknown>,
      kind: MODEL_ANSWER_KIND,
      schemaVersion: MODEL_SCHEMA_VERSION,
    } as never,
    item,
    { now: new Date("2026-01-01T00:00:00Z") } as never,
  );

  return { score: evaluation.awardedScore, status: evaluation.status };
}

describe("compiling a model directive", () => {
  test("a simple exercise stores its formulas and its target", async () => {
    const artifact = await compileArtifact(
      directive(
        '#ex1 title="A model" points="3"',
        "Build a model.\n\n- AxF(x), ExG(x)",
      ),
    );
    const item = artifact.manifest[0] as ExerciseManifestItem;
    const data = publicDataOf(item);

    expect(item.kind).toBe(MODEL_KIND);
    expect(item.nominalPoints).toBe(3);
    expect(data.variant).toBe("simple");
    expect(data.dialect).toBe("forallx-calgary-2019");
    expect(data.required).toEqual([]);
    expect(data.targeted).toEqual(["AxF(x)", "ExG(x)"]);
    // A simple exercise asks for a model that makes its formulas true, which is
    // Carnap's `truthful` default.
    expect(data.target).toBe("all-true");
    expect(data.promptHtml).toContain("Build a model.");
  });

  test("commas inside an argument list do not split a formula", async () => {
    // The propositional profile splits on every comma; here `R(a,b)` would
    // become two fragments if this did the same.
    const data = publicDataOf(
      await declaration(directive("#ex2", "- R(a,b), F(c)")),
    );

    expect(data.targeted).toEqual(["R(a,b)", "F(c)"]);
  });

  test("a validity exercise splits the sequent and flips the target", async () => {
    const data = publicDataOf(
      await declaration(
        directive(
          '#ex3 variant="validity"',
          "Show it is invalid.\n\nAxEyR(x,y) :|-: ExAyR(y,x)",
        ),
      ),
    );

    expect(data.required).toEqual(["AxEyR(x,y)"]);
    expect(data.targeted).toEqual(["ExAyR(y,x)"]);
    // A counterexample to validity: premises true, conclusions false.
    expect(data.target).toBe("all-false");
  });

  test("a constraint exercise takes its constraints from a list item", async () => {
    const data = publicDataOf(
      await declaration(
        directive(
          '#ex4 variant="constraint"',
          "Make it true, and note this:\n\n- ExEy~x = y : AxAyF(x,y)",
        ),
      ),
    );

    expect(data.required).toEqual(["ExEy~x = y"]);
    expect(data.targeted).toEqual(["AxAyF(x,y)"]);
    expect(data.target).toBe("all-true");
    // The prose colon is prose: only a list item is read as the separator.
    expect(data.promptHtml).toContain("note this");
  });

  test("counterexample-to overrides the target, in Carnap's vocabulary", async () => {
    const targets = await Promise.all(
      [
        ["tautology", "all-false"],
        ["validity", "all-false"],
        ["inconsistency", "all-true"],
        ["contradiction", "all-true"],
        ["equivalence", "not-all-equal"],
      ].map(async ([attribute, expected], index) => {
        const data = publicDataOf(
          await declaration(
            directive(
              `#target${index} counterexample-to="${attribute}"`,
              "- AxF(x)",
            ),
          ),
        );

        return [data.target, expected];
      }),
    );

    for (const [actual, expected] of targets) {
      expect(actual).toBe(expected);
    }
  });

  test("options and the check attribute agree on turning Check off", async () => {
    for (const attrs of ['#c1 check="off"', '#c2 options="nocheck"']) {
      const data = publicDataOf(
        await declaration(directive(attrs, "- AxF(x)")),
      );

      expect(data.options.check).toBe("off");
    }

    const on = publicDataOf(await declaration(directive("#c3", "- AxF(x)")));

    expect(on.options.check).toBe("on");
  });

  test("check= and nocheck are read as the shared feedback setting", async () => {
    const cases: readonly [
      string,
      ExerciseManifestItem["feedback"],
      ModelCheckMode,
    ][] = [
      ['#k1 check="on"', "full", "on"],
      ['#k2 check="off"', "none", "off"],
      ['#k3 options="nocheck"', "none", "off"],
      // Unwritten stays unwritten, or every model ever authored would override
      // the `exam` default and keep offering Check through an exam.
      ["#k4", undefined, "on"],
      // The model's own Check is a verdict and a sentence — it has no middle
      // setting, so `terse` still leaves the button on.
      ['#k5 feedback="terse"', "terse", "on"],
      ['#k6 feedback="none"', "none", "off"],
    ];

    for (const [attrs, feedback, check] of cases) {
      const item = await declaration(directive(attrs, "- AxF(x)"));

      expect(item.feedback, attrs).toBe(feedback);
      expect(publicDataOf(item).options.check, attrs).toBe(check);
    }
  });

  test("saying it twice earns a diagnostic", async () => {
    const compiled = await compileCarnapMarkdown(
      directive('#k7 check="on" feedback="none"', "- AxF(x)"),
    );

    expect(compiled.diagnostics.map((item) => item.code)).toContain(
      "redundant_check_attribute",
    );
  });

  test("givens are stored by field label", async () => {
    const data = publicDataOf(
      await declaration(
        directive(
          "#g1",
          "- AxF(x), G(a)\n| Domain : 0,1,2\n| F(_) : 1,2\n| a : 1",
        ),
      ),
    );

    expect(data.givens).toEqual({
      Domain: "0,1,2",
      "F(_)": "1,2",
      a: "1",
    });
  });

  test("a given for a field the exercise does not have is rejected", async () => {
    // Carnap only notices this when a student submits, and then only in the
    // browser console.
    expect(
      await compileCodes(directive("#g2", "- AxF(x)\n| H(_) : 0")),
    ).toContain("unknown_model_given_field");
  });

  test("a given the field could not hold is rejected", async () => {
    expect(
      await compileCodes(directive("#g3", "- AxF(x)\n| F(_) : [0,1]")),
    ).toContain("invalid_model_given_value");
    expect(
      await compileCodes(directive("#g4", "- AxF(x)\n| Domain : one")),
    ).toContain("invalid_model_given_value");
  });

  test("a duplicated given is rejected", async () => {
    expect(
      await compileCodes(
        directive("#g5", "- AxF(x)\n| F(_) : 0\n| F(_) : 1"),
      ),
    ).toContain("duplicate_model_given");
  });

  test("an unparseable formula is reported against its line", async () => {
    const codes = await compileCodes(directive("#bad1", "- Ax(F(x)"));

    expect(codes).toContain("invalid_formula");
  });

  test("a free variable is reported, since forallx has no open formulas", async () => {
    expect(await compileCodes(directive("#bad2", "- F(x)"))).toContain(
      "invalid_formula",
    );
  });

  test("an exercise with no formulas is rejected", async () => {
    expect(await compileCodes(directive("#bad3", "Just prose."))).toContain(
      "empty_model_exercise",
    );
  });

  test("a validity exercise without a turnstile is rejected", async () => {
    expect(
      await compileCodes(directive('#bad4 variant="validity"', "- AxF(x)")),
    ).toContain("missing_turnstile");
  });

  test("a constraint exercise without a separator is rejected", async () => {
    expect(
      await compileCodes(directive('#bad5 variant="constraint"', "- AxF(x)")),
    ).toContain("missing_constraint_separator");
  });

  test("an unknown system and an unknown option are rejected", async () => {
    expect(
      await compileCodes(directive('#bad6 system="firstOrder"', "- AxF(x)")),
    ).toContain("unsupported_model_system");
    expect(
      await compileCodes(directive('#bad7 options="autoAtoms"', "- AxF(x)")),
    ).toContain("unknown_model_option");
  });

  test("Carnap's inert forallxStyle flag still compiles", async () => {
    // Recognised so a ported problem does not fail to compile; it does nothing.
    expect(
      await compileCodes(
        directive('#ok1 options="forallxStyle"', "- AxF(x)"),
      ),
    ).toEqual([]);
  });
});

describe("resolving stored public data", () => {
  test("the field list is derived from the formulas, not stored", async () => {
    const data = publicDataOf(
      await declaration(directive("#r1", "- Ax(F(x) -> G(f(x))), H(a)")),
    );

    expect("fields" in data).toBe(false);

    const resolved = resolveModel(data);

    expect(resolved?.signature.map((field) => field.label)).toEqual([
      "Domain",
      "F(_)",
      "G(_)",
      "H(_)",
      "a",
      "f(_)",
    ]);
  });

  test("an unknown dialect resolves to nothing rather than half a model", async () => {
    const data = publicDataOf(
      await declaration(directive("#r2", "- AxF(x)")),
    );

    expect(resolveModel({ ...data, dialect: "gone" })).toBeNull();
  });
});

describe("grading a submitted model", () => {
  test("a model that does what was asked earns full marks", async () => {
    expect(
      await score(directive('#s1 points="4"', "- AxF(x), ExG(x)"), {
        domain: "0,1",
        fields: { "F(_)": "0,1", "G(_)": "1" },
      }),
    ).toEqual({ score: 4, status: "correct" });
  });

  test("a model that does not is worth nothing — there is no partial model", async () => {
    expect(
      await score(directive('#s2 points="4"', "- AxF(x)"), {
        domain: "0,1",
        fields: { "F(_)": "0" },
      }),
    ).toEqual({ score: 0, status: "incorrect" });
  });

  test("an unreadable model scores zero rather than erroring", async () => {
    expect(
      await score(directive("#s3", "- AxF(x)"), {
        domain: "",
        fields: {},
      }),
    ).toEqual({ score: 0, status: "incorrect" });
  });

  test("a validity counterexample is graded on both sides of the turnstile", async () => {
    const source = directive(
      '#s4 variant="validity" points="2"',
      "AxEyR(x,y) :|-: ExAyR(y,x)",
    );

    expect(
      await score(source, {
        domain: "0,1",
        fields: { "R(_,_)": "[0,1],[1,0]" },
      }),
    ).toEqual({ score: 2, status: "correct" });
    // The full relation makes the conclusion true, so it is no counterexample.
    expect(
      await score(source, {
        domain: "0,1",
        fields: { "R(_,_)": "[0,0],[0,1],[1,0],[1,1]" },
      }),
    ).toEqual({ score: 0, status: "incorrect" });
  });

  test("a constraint keeps the one-element model from cheating", async () => {
    const source = directive(
      '#s5 variant="constraint"',
      "- ExEy~x = y : AxAyF(x,y)",
    );

    expect(
      await score(source, { domain: "0", fields: { "F(_,_)": "[0,0]" } }),
    ).toEqual({ score: 0, status: "incorrect" });
    expect(
      await score(source, {
        domain: "0,1",
        fields: { "F(_,_)": "[0,0],[0,1],[1,0],[1,1]" },
      }),
    ).toEqual({ score: 1, status: "correct" });
  });
});

describe("normalizing an answer", () => {
  test("accepts a well-shaped model", async () => {
    const item = await declaration(directive("#n1", "- AxF(x)"));
    const result = handler.normalizeAnswer(
      envelope({ domain: "0", fields: { "F(_)": "0" } }) as never,
      item,
    );

    expect(result.ok).toBe(true);
  });

  test("rejects data that is not a model at all", async () => {
    const item = await declaration(directive("#n2", "- AxF(x)"));
    const result = handler.normalizeAnswer(
      {
        data: { domain: 3 },
        kind: MODEL_ANSWER_KIND,
        schemaVersion: 1,
      } as never,
      item,
    );

    expect(result.ok).toBe(false);
  });

  test("drops fields the exercise never asked for", async () => {
    // Otherwise a submission could grow the stored answer without limit.
    const item = await declaration(directive("#n3", "- AxF(x)"));
    const result = handler.normalizeAnswer(
      envelope({
        domain: "0",
        fields: { "F(_)": "0", "Z(_)": "0,1,2,3" },
      }) as never,
      item,
    );

    expect(result.ok).toBe(true);

    if (result.ok) {
      const data = result.answer.data as unknown as ModelAnswerData;

      expect(Object.keys(data.fields)).toEqual(["F(_)"]);
    }
  });
});

describe("strict givens", () => {
  test("a locked given is graded as set, whatever was submitted", async () => {
    // The original crashes the widget on a mismatch; grading the exercise as
    // set is the same refusal without taking the page down.
    const source = directive(
      '#l1 options="strictGivens"',
      "- AxF(x)\n| Domain : 0,1",
    );

    // Submitting a one-element domain would make `AxF(x)` true for free.
    expect(
      await score(source, { domain: "0", fields: { "F(_)": "0" } }),
    ).toEqual({ score: 0, status: "incorrect" });
    expect(
      await score(source, { domain: "0", fields: { "F(_)": "0,1" } }),
    ).toEqual({ score: 1, status: "correct" });
  });

  test("without strictGivens a given is only a starting point", async () => {
    const source = directive("#l2", "- AxF(x)\n| Domain : 0,1");

    expect(
      await score(source, { domain: "0", fields: { "F(_)": "0" } }),
    ).toEqual({ score: 1, status: "correct" });
  });

  test("effectiveAnswer substitutes only when the givens are locked", async () => {
    const locked = publicDataOf(
      await declaration(
        directive('#l3 options="strictGivens"', "- AxF(x)\n| F(_) : 0"),
      ),
    );
    const loose = publicDataOf(
      await declaration(directive("#l4", "- AxF(x)\n| F(_) : 0")),
    );
    const answer: ModelAnswerData = {
      domain: "0,1",
      fields: { "F(_)": "0,1" },
    };

    expect(effectiveAnswer(locked, answer).fields["F(_)"]).toBe("0");
    expect(effectiveAnswer(loose, answer).fields["F(_)"]).toBe("0,1");
  });
});

describe("the rendered element", () => {
  test("renders one inert row per field, with the goal above them", async () => {
    const artifact = await compileArtifact(
      directive("#v1", "- AxF(x), G(a)"),
    );
    const html = renderCompiledContent(artifact, i18nFor("en"));

    expect(html).toContain("<carnap-model");
    expect(html).toContain('<template shadowrootmode="open">');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('data-field="Domain"');
    expect(html).toContain('data-field="F(_)"');
    expect(html).toContain('data-field="a"');
    // Shown in logical symbols, not the ascii it is stored as.
    expect(html).toContain("∀xF(x), G(a)");
  });

  test("a constant is a select over the domain, seeded from any given", async () => {
    const artifact = await compileArtifact(
      directive("#v2", "- G(a)\n| Domain : 0,1,2"),
    );
    const html = renderCompiledContent(artifact, i18nFor("en"));

    // Three options, because the seeded domain has three elements, and the
    // first is preselected.
    expect(html).toContain('<option selected value="0">0</option>');
    expect(html).toContain('<option value="1">1</option>');
    expect(html).toContain('<option value="2">2</option>');
    expect(html).toContain('data-kind="constant"');
  });

  test("a function gets one control per argument tuple over the domain", async () => {
    const artifact = await compileArtifact(
      directive("#v3", "- Axf(x) = x\n| Domain : 0,1"),
    );
    const html = renderCompiledContent(artifact, i18nFor("en"));

    expect(html).toContain('data-argument="0"');
    expect(html).toContain('data-argument="1"');
    expect(html).toContain('data-kind="function"');
  });

  test("the goal shows a sequent for a validity exercise", async () => {
    const single = publicDataOf(
      await declaration(
        directive('#v4 variant="validity"', "AxF(x) :|-: ExF(x)"),
      ),
    );
    const negated = publicDataOf(
      await declaration(
        directive(
          '#v5 variant="validity" options="negated-double-turnstile"',
          "AxF(x) :|-: ExF(x)",
        ),
      ),
    );

    expect(modelGoalText(single)).toBe("∀xF(x) ⊢ ∃xF(x)");
    expect(modelGoalText(negated)).toBe("∀xF(x) ⊭ ∃xF(x)");
  });

  test("a constraint exercise's constraints stay off the page", async () => {
    // The manual calls them implicit; showing them would give the answer away.
    const data = publicDataOf(
      await declaration(
        directive('#v6 variant="constraint"', "- ExEy~x = y : AxAyF(x,y)"),
      ),
    );

    expect(modelGoalText(data)).toBe("∀x∀yF(x,y)");
  });
});

describe("reviewing a submitted model", () => {
  test("the summary is the same sentence the widget's Check shows", async () => {
    const item = await declaration(directive("#w1", "- AxF(x)"));
    const answer = {
      data: { domain: "0,1", fields: { "F(_)": "0" } },
      kind: MODEL_ANSWER_KIND,
      schemaVersion: MODEL_SCHEMA_VERSION,
    };
    const review = handler.reviewAnswer(
      answer as never,
      item,
      REVIEW_CONTEXT as never,
    );

    expect(review.summary).toBe(
      "Not all formulas are true in this model. Take another look at: ∀xF(x).",
    );
    expect(review.elementHtml).toContain("<carnap-model");
  });

  test("a correct model is reported as such", async () => {
    const item = await declaration(directive("#w2", "- AxF(x)"));
    const review = handler.reviewAnswer(
      {
        data: { domain: "0,1", fields: { "F(_)": "0,1" } },
        kind: MODEL_ANSWER_KIND,
        schemaVersion: MODEL_SCHEMA_VERSION,
      } as never,
      item,
      REVIEW_CONTEXT as never,
    );

    expect(review.summary).toBe(
      "This model does everything the exercise asks.",
    );
  });

  test("the review widget shows what the student actually typed", async () => {
    const data = publicDataOf(
      await declaration(directive("#w3", "- AxF(x)")),
    );
    const html = renderModelReview(
      data,
      {
        answer: { domain: "0, 1", fields: { "F(_)": "[0],[1]" } },
        exerciseId: "w3",
        verdict: {
          ok: true,
          problem: null,
          requiredFalse: [],
          targetMissed: false,
          targetOffenders: [],
        },
      },
      passthroughTranslator,
    );

    // Not a normalized rendering: an instructor reading a wrong answer wants to
    // see the wrong thing.
    expect(html).toContain("0, 1");
    expect(html).toContain("[0],[1]");
    expect(html).toContain("data-review");
  });

  test("a validity failure names premises and conclusions", async () => {
    const item = await declaration(
      directive('#w4 variant="validity"', "AxF(x) :|-: ExF(x)"),
    );
    const review = handler.reviewAnswer(
      {
        // The premise is false and the conclusion true: both halves wrong.
        data: { domain: "0,1", fields: { "F(_)": "0" } },
        kind: MODEL_ANSWER_KIND,
        schemaVersion: MODEL_SCHEMA_VERSION,
      } as never,
      item,
      REVIEW_CONTEXT as never,
    );

    expect(review.summary).toContain("Not all premises are true");
    expect(review.summary).toContain("Not all conclusions are false");
  });

  test("an unreadable model is described rather than judged", async () => {
    const item = await declaration(directive("#w5", "- AxF(x)"));
    const review = handler.reviewAnswer(
      {
        data: { domain: "", fields: {} },
        kind: MODEL_ANSWER_KIND,
        schemaVersion: MODEL_SCHEMA_VERSION,
      } as never,
      item,
      REVIEW_CONTEXT as never,
    );

    expect(review.summary).toBe("The domain cannot be empty.");
  });
});
