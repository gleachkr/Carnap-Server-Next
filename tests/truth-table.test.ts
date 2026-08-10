import { describe, expect, test } from "bun:test";
import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import {
  TRUTH_TABLE_ANSWER_KIND,
  TRUTH_TABLE_KIND,
  TRUTH_TABLE_SCHEMA_VERSION,
  TruthTableExerciseHandler,
} from "../src/worker/application/content/registry";
import { renderCompiledContent } from "../src/worker/application/content/renderer";
import type {
  CompiledContentArtifact,
  ExerciseManifestItem,
} from "../src/worker/domain/content";
import {
  cellFillable,
  correctCells,
  counterexampleHolds,
  fillableCellCount,
  gradeTruthTable,
  referenceFillable,
  resolveTable,
  sequentHolds,
  truthTableScoreFraction,
} from "../src/worker/exercises/truth-table/grading";
import {
  formulaCells,
  parseFormula,
} from "../src/worker/exercises/truth-table/logic";
import { renderTruthTableReview } from "../src/worker/exercises/truth-table/read-only-view";
import type {
  TruthTableAnswerData,
  TruthTableCheckMode,
  TruthTableOptions,
  TruthTablePublicData,
} from "../src/worker/exercises/truth-table/types";
import { i18nFor } from "../src/worker/i18n";
import {
  passthroughTranslator,
  type Translator,
} from "../src/worker/i18n/translator";

/** Review text is resolved for a viewer, so a review needs a translator. */
const REVIEW_CONTEXT = {
  audience: "student",
  i18n: passthroughTranslator,
} as const;

const DEFAULT_OPTIONS: TruthTableOptions = {
  autoAtoms: false,
  check: "cells",
  counterexampleTo: "tautology",
  falseMark: "F",
  fill: "all",
  grading: "all-or-nothing",
  hiddenGivens: false,
  nodash: false,
  showCounterexample: true,
  strictGivens: false,
  trueMark: "T",
  turnstileGlyph: "single",
};

function directive(attrs: string, body: string): string {
  return `::::truth-table{${attrs}}\n${body}\n::::`;
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

function publicDataOf(item: ExerciseManifestItem): TruthTablePublicData {
  return item.publicData as unknown as TruthTablePublicData;
}

describe("truth-table layout", () => {
  test("negation's operand is parenthesized only when binary", () => {
    const parsed = parseFormula("~(P /\\ Q)");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const cells = formulaCells(parsed.formula);
      expect(cells.map((c) => c.text)).toEqual(["~", "P", "/\\", "Q"]);
    }
  });

  test("cells carry role and a single main flag", () => {
    const parsed = parseFormula("P -> Q");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const cells = formulaCells(parsed.formula);
      expect(cells.map((c) => ({ main: c.isMain, role: c.role }))).toEqual([
        { main: false, role: "atom" },
        { main: true, role: "connective" },
        { main: false, role: "atom" },
      ]);
    }
  });
});

describe("truth-table grading", () => {
  const publicData: TruthTablePublicData = {
    formulas: ["(P -> P)"],
    options: DEFAULT_OPTIONS,
    promptHtml: "",
    variant: "simple",
  };

  test("resolves atoms, rows, and cells", () => {
    const table = resolveTable(publicData.formulas);
    expect(table).not.toBeNull();
    if (table !== null) {
      expect(table.atoms).toEqual(["P"]);
      expect(table.valuations.length).toBe(2);
      expect(table.formulas[0]?.cells.length).toBe(3);
    }
  });

  test("counts every fillable cell under fill=all", () => {
    const table = resolveTable(publicData.formulas);
    if (table !== null) {
      // 2 rows × (1 reference atom + 3 formula cells) = 8.
      expect(fillableCellCount(table, DEFAULT_OPTIONS)).toBe(8);
    }
  });

  test("a fully-correct grid scores 1 and is all-correct", () => {
    const answer: TruthTableAnswerData = {
      cells: [
        [
          ["T", "T", "T"],
          ["F", "T", "F"],
        ],
      ],
      reference: [["T"], ["F"]],
    };
    const grade = gradeTruthTable(publicData, answer);
    expect(grade).not.toBeNull();
    if (grade !== null) {
      expect(grade.allCorrect).toBe(true);
      expect(grade.correctCount).toBe(8);
      expect(truthTableScoreFraction(grade, "all-or-nothing")).toBe(1);
    }
  });

  test("one wrong cell fails all-or-nothing but earns partial credit", () => {
    const answer: TruthTableAnswerData = {
      cells: [
        [
          ["T", "T", "T"],
          ["F", "F", "F"], // middle cell should be T
        ],
      ],
      reference: [["T"], ["F"]],
    };
    const grade = gradeTruthTable(publicData, answer);
    if (grade !== null) {
      expect(grade.allCorrect).toBe(false);
      expect(grade.correctCount).toBe(7);
      expect(truthTableScoreFraction(grade, "all-or-nothing")).toBe(0);
      expect(truthTableScoreFraction(grade, "partial")).toBeCloseTo(7 / 8);
    }
  });

  test("blank cells count as incorrect", () => {
    const answer: TruthTableAnswerData = {
      cells: [
        [
          ["", "", ""],
          ["", "", ""],
        ],
      ],
      reference: [[""], [""]],
    };
    const grade = gradeTruthTable(publicData, answer);
    if (grade !== null) {
      expect(grade.correctCount).toBe(0);
    }
  });

  test("autoAtoms gives the reference columns; connectives-only narrows fill", () => {
    const options: TruthTableOptions = {
      ...DEFAULT_OPTIONS,
      autoAtoms: true,
      fill: "connectives",
    };
    const table = resolveTable(publicData.formulas);
    if (table !== null) {
      expect(referenceFillable(options)).toBe(false);
      // Only the one connective cell is fillable, across 2 rows.
      expect(fillableCellCount(table, options)).toBe(2);
      const cells = table.formulas[0]?.cells ?? [];
      expect(cells.filter((c) => cellFillable(c, options)).length).toBe(1);
    }
  });

  test("correct cells match the semantics", () => {
    const table = resolveTable(publicData.formulas);
    if (table !== null) {
      // (P -> P) columns are [P, ->, P]; the middle is always true.
      expect(correctCells(table)[0]).toEqual([
        [true, true, true],
        [false, true, false],
      ]);
    }
  });
});

describe("truth-table compile", () => {
  test("compiles a simple directive with defaults", async () => {
    const artifact = await compileArtifact(
      directive('#tt1 variant="simple"', "Is this a tautology?\n\n- P -> P"),
    );
    const item = artifact.manifest[0];
    expect(item?.kind).toBe(TRUTH_TABLE_KIND);

    const data = publicDataOf(item as ExerciseManifestItem);
    expect(data.formulas).toEqual(["(P -> P)"]);
    expect(data.options).toEqual(DEFAULT_OPTIONS);
    expect(data.promptHtml).toContain("tautology");
  });

  test("a single bullet may list comma-separated formulas", async () => {
    const artifact = await compileArtifact(
      directive("#multi", "- P -> Q, Q -> P"),
    );
    const data = publicDataOf(artifact.manifest[0] as ExerciseManifestItem);
    expect(data.formulas).toEqual(["(P -> Q)", "(Q -> P)"]);
  });

  test("carries authoring options into public data", async () => {
    const artifact = await compileArtifact(
      directive(
        '#tt2 fill="connectives" grading="partial" options="autoAtoms nodash"',
        "- P -> Q",
      ),
    );
    const data = publicDataOf(artifact.manifest[0] as ExerciseManifestItem);
    expect(data.options).toEqual({
      autoAtoms: true,
      check: "cells",
      counterexampleTo: "tautology",
      falseMark: "F",
      fill: "connectives",
      grading: "partial",
      hiddenGivens: false,
      nodash: true,
      showCounterexample: true,
      strictGivens: false,
      trueMark: "T",
      turnstileGlyph: "single",
    });
  });

  test("parses the check mode and the nocheck flag", async () => {
    const terse = await compileArtifact(
      directive('#c1 check="terse"', "- P -> Q"),
    );
    expect(
      publicDataOf(terse.manifest[0] as ExerciseManifestItem).options.check,
    ).toBe("terse");

    const off = await compileArtifact(
      directive('#c2 options="nocheck"', "- P -> Q"),
    );
    expect(
      publicDataOf(off.manifest[0] as ExerciseManifestItem).options.check,
    ).toBe("off");
  });

  test("rejects an invalid check mode", async () => {
    const codes = await compileCodes(
      directive('#c3 check="loud"', "- P -> Q"),
    );
    expect(codes).toContain("invalid_check_mode");
  });

  test("check= and nocheck are read as the shared feedback setting", async () => {
    const cases: readonly [
      string,
      ExerciseManifestItem["feedback"],
      TruthTableCheckMode,
    ][] = [
      ['#f1 check="cells"', "full", "cells"],
      ['#f2 check="terse"', "terse", "terse"],
      ['#f3 check="off"', "none", "off"],
      ['#f4 options="nocheck"', "none", "off"],
      // Written by nobody, so it must stay absent — read as an explicit
      // request for cell marks it would override the `exam` default for every
      // table ever authored.
      ["#f5", undefined, "cells"],
      ['#f6 feedback="none"', "none", "off"],
    ];

    for (const [attrs, feedback, check] of cases) {
      const artifact = await compileArtifact(directive(attrs, "- P -> Q"));
      const item = artifact.manifest[0] as ExerciseManifestItem;

      expect(item.feedback, attrs).toBe(feedback);
      expect(publicDataOf(item).options.check, attrs).toBe(check);
    }
  });

  test("saying it twice earns a diagnostic, and feedback wins", async () => {
    const source = directive('#f7 check="cells" feedback="none"', "- P -> Q");

    expect(await compileCodes(source)).toContain("redundant_check_attribute");
  });

  test("renders an inert shadow-DOM grid", async () => {
    const artifact = await compileArtifact(directive("#tt3", "- P -> Q"));
    const html = renderCompiledContent(artifact, i18nFor("en"));
    expect(html).toContain("<carnap-truth-table");
    expect(html).toContain('shadowrootmode="open"');
    expect(html).toContain('<table class="tt"');
    expect(html).toContain('data-tt-role="cell"');
    expect(html).toContain("disabled");
  });

  const errorCases: ReadonlyArray<readonly [string, string, string]> = [
    ["rejects an unparseable formula", "#e1", "- P ->"],
    ["requires at least one formula", "#e2", "just a prompt"],
    ["rejects an unknown option", '#e3 options="frobnicate"', "- P"],
    ["rejects an invalid fill scope", '#e4 fill="sideways"', "- P -> Q"],
    ["rejects an unknown variant", '#e5 variant="modal"', "- P"],
  ];

  for (const [name, attrs, body] of errorCases) {
    test(name, async () => {
      const codes = await compileCodes(directive(attrs, body));
      expect(codes.length).toBeGreaterThan(0);
    });
  }

  test("rejects tables beyond the atom cap", async () => {
    const formula = Array.from({ length: 13 }, (_, i) =>
      String.fromCharCode(65 + i),
    ).join(" /\\ ");
    const codes = await compileCodes(directive("#big", `- ${formula}`));
    expect(codes).toContain("too_many_atoms");
  });
});

describe("truth-table assessment", () => {
  const handler = new TruthTableExerciseHandler();

  async function declaration(source: string): Promise<ExerciseManifestItem> {
    const artifact = await compileArtifact(source);
    return artifact.manifest[0] as ExerciseManifestItem;
  }

  function envelope(data: TruthTableAnswerData) {
    return {
      data: data as unknown as Record<string, unknown>,
      kind: TRUTH_TABLE_ANSWER_KIND,
      schemaVersion: TRUTH_TABLE_SCHEMA_VERSION,
    };
  }

  const correctAnswer: TruthTableAnswerData = {
    cells: [
      [
        ["T", "T", "T"],
        ["F", "T", "F"],
      ],
    ],
    reference: [["T"], ["F"]],
  };

  test("normalizes a well-shaped answer", async () => {
    const item = await declaration(directive("#a1", "- P -> P"));
    const result = handler.normalizeAnswer(
      envelope(correctAnswer) as never,
      item,
    );
    expect(result.ok).toBe(true);
  });

  test("rejects a mis-shaped grid", async () => {
    const item = await declaration(directive("#a2", "- P -> P"));
    const result = handler.normalizeAnswer(
      envelope({ cells: [], reference: [] }) as never,
      item,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("schema-invalid");
    }
  });

  test("scores a correct submission full marks", async () => {
    const item = await declaration(directive('#a3 points="4"', "- P -> P"));
    const evaluation = await handler.evaluate(
      {
        data: correctAnswer as never,
        kind: TRUTH_TABLE_ANSWER_KIND,
        schemaVersion: TRUTH_TABLE_SCHEMA_VERSION,
      },
      item,
      { now: "2026-07-16T00:00:00.000Z" },
    );
    expect(evaluation.status).toBe("correct");
    expect(evaluation.awardedScore).toBe(4);
  });

  test("marks a partial-graded submission partial", async () => {
    const item = await declaration(
      directive('#a4 grading="partial" points="8"', "- P -> P"),
    );
    const wrong: TruthTableAnswerData = {
      cells: [
        [
          ["T", "T", "T"],
          ["F", "F", "F"],
        ],
      ],
      reference: [["T"], ["F"]],
    };
    const evaluation = await handler.evaluate(
      {
        data: wrong as never,
        kind: TRUTH_TABLE_ANSWER_KIND,
        schemaVersion: TRUTH_TABLE_SCHEMA_VERSION,
      },
      item,
      { now: "2026-07-16T00:00:00.000Z" },
    );
    expect(evaluation.status).toBe("partial");
    expect(evaluation.awardedScore).toBeCloseTo(7);
  });

  test("review renders a marked grid", async () => {
    const item = await declaration(directive("#a5", "- P -> P"));
    const review = handler.reviewAnswer?.(
      {
        data: correctAnswer as never,
        kind: TRUTH_TABLE_ANSWER_KIND,
        schemaVersion: TRUTH_TABLE_SCHEMA_VERSION,
      },
      item,
      REVIEW_CONTEXT,
    );
    expect(review?.elementHtml).toContain("data-review");
    expect(review?.elementHtml).toContain("tt-correct");
    expect(review?.summary).toBe("All cells correct.");
  });
});

describe("truth-table counterexample", () => {
  // P -> Q is not a tautology: false only at row 1 (P=T, Q=F) in the canonical
  // all-true-top order [TT, TF, FT, FF].
  const ptoq: TruthTablePublicData = {
    formulas: ["(P -> Q)"],
    options: DEFAULT_OPTIONS,
    promptHtml: "",
    variant: "simple",
  };

  const blankRefs: TruthTableAnswerData["reference"] = [
    ["", ""],
    ["", ""],
    ["", ""],
    ["", ""],
  ];
  const blankCells: TruthTableAnswerData["cells"] = [
    [
      ["", "", ""],
      ["", "", ""],
      ["", "", ""],
      ["", "", ""],
    ],
  ];

  test("counterexampleHolds reads the target predicate off a row", () => {
    const table = resolveTable(["P", "Q"]);
    expect(table).not.toBeNull();
    if (table !== null) {
      // Rows: 0=TT, 1=TF, 2=FT, 3=FF.
      expect(counterexampleHolds(table, 0, "inconsistency")).toBe(true); // both T
      expect(counterexampleHolds(table, 1, "inconsistency")).toBe(false);
      expect(counterexampleHolds(table, 3, "tautology")).toBe(true); // both F
      expect(counterexampleHolds(table, 0, "tautology")).toBe(false);
      expect(counterexampleHolds(table, 1, "equivalence")).toBe(true); // T,F differ
      expect(counterexampleHolds(table, 0, "equivalence")).toBe(false); // T,T agree
    }
  });

  test("a correctly-filled false row is accepted as a counterexample", () => {
    const answer: TruthTableAnswerData = {
      cells: [
        [
          ["", "", ""],
          ["T", "F", "F"], // P=T, (P->Q)=F, Q=F
          ["", "", ""],
          ["", "", ""],
        ],
      ],
      counterexample: 1,
      reference: [
        ["", ""],
        ["T", "F"],
        ["", ""],
        ["", ""],
      ],
    };
    const grade = gradeTruthTable(ptoq, answer);
    expect(grade).not.toBeNull();
    if (grade !== null) {
      expect(grade.counterexample).toEqual({
        filledCorrectly: true,
        predicateHolds: true,
        row: 1,
      });
      expect(grade.allCorrect).toBe(true);
      // All-or-nothing even under partial grading.
      expect(truthTableScoreFraction(grade, "partial")).toBe(1);
    }
  });

  test("a correct row that is not a counterexample is rejected", () => {
    const answer: TruthTableAnswerData = {
      cells: [
        [
          ["T", "T", "T"], // row 0: P=T, (P->Q)=T, Q=T — true, not a counterexample
          ["", "", ""],
          ["", "", ""],
          ["", "", ""],
        ],
      ],
      counterexample: 0,
      reference: [
        ["T", "T"],
        ["", ""],
        ["", ""],
        ["", ""],
      ],
    };
    const grade = gradeTruthTable(ptoq, answer);
    if (grade !== null) {
      expect(grade.counterexample?.filledCorrectly).toBe(true);
      expect(grade.counterexample?.predicateHolds).toBe(false);
      expect(grade.allCorrect).toBe(false);
      expect(truthTableScoreFraction(grade, "partial")).toBe(0);
    }
  });

  test("a mis-filled counterexample row is rejected", () => {
    const answer: TruthTableAnswerData = {
      cells: [
        [
          ["", "", ""],
          ["T", "T", "F"], // -> should be F
          ["", "", ""],
          ["", "", ""],
        ],
      ],
      counterexample: 1,
      reference: [
        ["", ""],
        ["T", "F"],
        ["", ""],
        ["", ""],
      ],
    };
    const grade = gradeTruthTable(ptoq, answer);
    if (grade !== null) {
      expect(grade.counterexample?.filledCorrectly).toBe(false);
      expect(grade.counterexample?.predicateHolds).toBe(true);
      expect(grade.allCorrect).toBe(false);
    }
  });

  test("nocounterexample ignores a submitted counterexample index", () => {
    const disabled: TruthTablePublicData = {
      ...ptoq,
      options: { ...DEFAULT_OPTIONS, showCounterexample: false },
    };
    const answer: TruthTableAnswerData = {
      cells: blankCells,
      counterexample: 1,
      reference: blankRefs,
    };
    const grade = gradeTruthTable(disabled, answer);
    if (grade !== null) {
      // Graded as a (mostly blank) full table, not as a counterexample.
      expect(grade.counterexample).toBeNull();
      expect(grade.fillableCount).toBe(20);
    }
  });

  test("compiles counterexample-to and the nocounterexample flag", async () => {
    const equiv = await compileArtifact(
      directive('#cx1 counterexample-to="equivalence"', "- P -> Q"),
    );
    const equivOpts = publicDataOf(
      equiv.manifest[0] as ExerciseManifestItem,
    ).options;
    expect(equivOpts.counterexampleTo).toBe("equivalence");
    expect(equivOpts.showCounterexample).toBe(true);

    // A Carnap synonym normalizes to its canonical property.
    const contradiction = await compileArtifact(
      directive('#cx1b counterexample-to="contradiction"', "- P -> Q"),
    );
    expect(
      publicDataOf(contradiction.manifest[0] as ExerciseManifestItem).options
        .counterexampleTo,
    ).toBe("inconsistency");

    const off = await compileArtifact(
      directive('#cx2 options="nocounterexample"', "- P -> Q"),
    );
    expect(
      publicDataOf(off.manifest[0] as ExerciseManifestItem).options
        .showCounterexample,
    ).toBe(false);
  });

  test("rejects an invalid counterexample target", async () => {
    const codes = await compileCodes(
      directive('#cx3 counterexample-to="mystery"', "- P -> Q"),
    );
    expect(codes).toContain("invalid_counterexample_target");
  });

  test("normalize preserves the index; out-of-range is rejected", async () => {
    const handler = new TruthTableExerciseHandler();
    const item = (await compileArtifact(directive("#cx4", "- P -> Q")))
      .manifest[0] as ExerciseManifestItem;

    const good = handler.normalizeAnswer(
      {
        data: {
          cells: blankCells,
          counterexample: 1,
          reference: blankRefs,
        } as unknown as Record<string, unknown>,
        kind: TRUTH_TABLE_ANSWER_KIND,
        schemaVersion: TRUTH_TABLE_SCHEMA_VERSION,
      } as never,
      item,
    );
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(
        (good.answer.data as { counterexample?: number }).counterexample,
      ).toBe(1);
    }

    const outOfRange = handler.normalizeAnswer(
      {
        data: {
          cells: blankCells,
          counterexample: 99,
          reference: blankRefs,
        } as unknown as Record<string, unknown>,
        kind: TRUTH_TABLE_ANSWER_KIND,
        schemaVersion: TRUTH_TABLE_SCHEMA_VERSION,
      } as never,
      item,
    );
    expect(outOfRange.ok).toBe(false);
  });

  test("evaluate and review report counterexample validity", async () => {
    const handler = new TruthTableExerciseHandler();
    const item = (
      await compileArtifact(directive('#cx5 points="3"', "- P -> Q"))
    ).manifest[0] as ExerciseManifestItem;
    const valid: TruthTableAnswerData = {
      cells: [
        [
          ["", "", ""],
          ["T", "F", "F"],
          ["", "", ""],
          ["", "", ""],
        ],
      ],
      counterexample: 1,
      reference: [
        ["", ""],
        ["T", "F"],
        ["", ""],
        ["", ""],
      ],
    };
    const evaluation = await handler.evaluate(
      {
        data: valid as never,
        kind: TRUTH_TABLE_ANSWER_KIND,
        schemaVersion: TRUTH_TABLE_SCHEMA_VERSION,
      },
      item,
      { now: "2026-07-16T00:00:00.000Z" },
    );
    expect(evaluation.status).toBe("correct");
    expect(evaluation.awardedScore).toBe(3);

    const review = handler.reviewAnswer?.(
      {
        data: valid as never,
        kind: TRUTH_TABLE_ANSWER_KIND,
        schemaVersion: TRUTH_TABLE_SCHEMA_VERSION,
      },
      item,
      REVIEW_CONTEXT,
    );
    expect(review?.summary).toBe("Valid counterexample.");
  });
});

describe("truth-table validity", () => {
  // Options as the validity compiler emits them: default property (tautology =
  // conclusions all false, the ordinary invalidity case), button shown.
  const VALIDITY_OPTIONS: TruthTableOptions = {
    ...DEFAULT_OPTIONS,
    counterexampleTo: "tautology",
    showCounterexample: true,
  };

  // Modus ponens: P, P -> Q :|-: Q — valid, so every turnstile mark is T.
  const modusPonens: TruthTablePublicData = {
    formulas: ["P", "(P -> Q)", "Q"],
    options: VALIDITY_OPTIONS,
    premiseCount: 2,
    promptHtml: "",
    variant: "validity",
  };

  test("sequentHolds flags the counterexample row of an invalid argument", () => {
    // Affirming the consequent: Q, P -> Q :|-: P. formulas = [Q, (P->Q), P],
    // premiseCount 2. Rows: 0=TT, 1=TF, 2=FT, 3=FF. The counterexample is FT
    // (P=F, Q=T): both premises true, conclusion P false.
    const table = resolveTable(["Q", "(P -> Q)", "P"]);
    expect(table).not.toBeNull();
    if (table !== null) {
      expect(sequentHolds(table, 2, 0)).toBe(true);
      expect(sequentHolds(table, 2, 1)).toBe(true);
      expect(sequentHolds(table, 2, 2)).toBe(false); // FT — the counterexample
      expect(sequentHolds(table, 2, 3)).toBe(true);
    }
  });

  test("a valid argument's turnstile column is all T", () => {
    const table = resolveTable(modusPonens.formulas);
    if (table !== null) {
      expect(
        table.valuations.map((_row, i) => sequentHolds(table, 2, i)),
      ).toEqual([true, true, true, true]);
    }
  });

  test("the turnstile column adds one graded cell per row", () => {
    const table = resolveTable(modusPonens.formulas);
    if (table !== null) {
      // 4 rows × (2 reference + 5 formula cells) = 28, + 4 turnstile = 32.
      expect(fillableCellCount(table, VALIDITY_OPTIONS)).toBe(28);
      expect(fillableCellCount(table, VALIDITY_OPTIONS, true)).toBe(32);
    }
  });

  test("grades the turnstile column against the sequent", () => {
    const table = resolveTable(modusPonens.formulas);
    if (table === null) {
      throw new Error("table failed to resolve");
    }

    const grade = gradeTruthTable(modusPonens, {
      cells: table.formulas.map((formula) =>
        table.valuations.map(() => formula.cells.map(() => "")),
      ),
      reference: table.valuations.map((row) => row.map(() => "")),
      validity: ["T", "T", "F", "T"], // row 2 wrongly marked a counterexample
    });
    expect(grade).not.toBeNull();
    if (grade !== null) {
      expect(grade.validity).toEqual([true, true, false, true]);
      expect(grade.counterexample).toBeNull();
      // Only the 3 correct turnstile marks are right; everything else is blank.
      expect(grade.correctCount).toBe(3);
    }
  });

  test("compiles a single-line sequent into premises then conclusions", async () => {
    const artifact = await compileArtifact(
      directive('#v1 variant="validity"', "Is it valid?\n\nP, P -> Q :|-: Q"),
    );
    const data = publicDataOf(artifact.manifest[0] as ExerciseManifestItem);
    expect(data.variant).toBe("validity");
    expect(data.formulas).toEqual(["P", "(P -> Q)", "Q"]);
    expect(data.premiseCount).toBe(2);
    // Validity offers the counterexample shortcut with the default property.
    expect(data.options.counterexampleTo).toBe("tautology");
    expect(data.options.showCounterexample).toBe(true);
    expect(data.promptHtml).toContain("valid");
  });

  test("validity honors counterexample-to on the conclusion side", async () => {
    const artifact = await compileArtifact(
      directive(
        '#v-eq variant="validity" counterexample-to="equivalence"',
        "P :|-: Q, R",
      ),
    );
    const data = publicDataOf(artifact.manifest[0] as ExerciseManifestItem);
    expect(data.options.counterexampleTo).toBe("equivalence");
    // Q, R :|-: with premise P — counterexample is a row where P is true and the
    // two conclusions disagree. Atoms P,Q,R; rows 0..7 all-true-top. Row 1 = TTF
    // (P=T,Q=T,R=F): premise true, conclusions differ → counterexample.
    const table = resolveTable(data.formulas);
    if (table !== null) {
      expect(counterexampleHolds(table, 1, "equivalence", 1)).toBe(true);
      // Row 0 = TTT: conclusions agree → not a counterexample.
      expect(counterexampleHolds(table, 0, "equivalence", 1)).toBe(false);
    }
  });

  test("nocounterexample turns off the validity shortcut", async () => {
    const artifact = await compileArtifact(
      directive(
        '#v-noce variant="validity" options="nocounterexample"',
        "P :|-: P",
      ),
    );
    const data = publicDataOf(artifact.manifest[0] as ExerciseManifestItem);
    // The button is off, but the property still defines the turnstile column.
    expect(data.options.showCounterexample).toBe(false);
    expect(data.options.counterexampleTo).toBe("tautology");
  });

  test("a valid row where premises hold and conclusion fails is a counterexample", () => {
    // Affirming the consequent: Q, P -> Q :|-: P. Row FT (index 2) is the one
    // counterexample; grading its designated row accepts it.
    const affirming: TruthTablePublicData = {
      formulas: ["Q", "(P -> Q)", "P"],
      options: VALIDITY_OPTIONS,
      premiseCount: 2,
      promptHtml: "",
      variant: "validity",
    };
    const table = resolveTable(affirming.formulas);
    if (table === null) {
      throw new Error("table failed to resolve");
    }
    // With the premise split, a validity counterexample = premises true (P->Q,
    // Q here) and conclusion (P) false, under the default tautology property.
    expect(counterexampleHolds(table, 2, "tautology", 2)).toBe(true);
    expect(counterexampleHolds(table, 0, "tautology", 2)).toBe(false);
    // Without the split it is read as a simple table (all formulas false) — not
    // the case on row 2, so it does not hold.
    expect(counterexampleHolds(table, 2, "tautology")).toBe(false);

    // Build a counterexample answer: only row 2 filled correctly, its ⊢ mark F.
    const key = correctCells(table);
    const b = (value: boolean): "T" | "F" => (value ? "T" : "F");
    const answer: TruthTableAnswerData = {
      cells: key.map((formula) =>
        formula.map((row, ri) => (ri === 2 ? row.map(b) : row.map(() => ""))),
      ),
      counterexample: 2,
      reference: table.valuations.map((row, ri) =>
        ri === 2 ? row.map(b) : row.map(() => ""),
      ),
      validity: table.valuations.map((_r, ri) => (ri === 2 ? "F" : "")),
    };
    const grade = gradeTruthTable(affirming, answer);
    expect(grade).not.toBeNull();
    if (grade !== null) {
      expect(grade.counterexample?.row).toBe(2);
      expect(grade.counterexample?.predicateHolds).toBe(true);
      expect(grade.counterexample?.filledCorrectly).toBe(true);
      expect(grade.allCorrect).toBe(true);
      expect(truthTableScoreFraction(grade, "partial")).toBe(1);
    }
  });

  const sequentErrors: ReadonlyArray<readonly [string, string, string]> = [
    ["needs a turnstile", "#s1", "P -> Q"],
    ["needs a premise", "#s2", ":|-: Q"],
    ["needs a conclusion", "#s3", "P :|-:"],
    ["rejects two turnstiles", "#s4", "P :|-: Q :|-: R"],
    ["rejects an unparseable formula", "#s5", "P -> :|-: Q"],
  ];

  for (const [name, id, body] of sequentErrors) {
    test(`validity ${name}`, async () => {
      const codes = await compileCodes(
        directive(`${id} variant="validity"`, body),
      );
      expect(codes.length).toBeGreaterThan(0);
    });
  }

  test("review renders the turnstile column with its marks", () => {
    const table = resolveTable(modusPonens.formulas);
    if (table === null) {
      throw new Error("table failed to resolve");
    }
    const key = correctCells(table);
    const mark = (value: boolean): "T" | "F" => (value ? "T" : "F");
    const html = renderTruthTableReview(
      modusPonens,
      {
        answer: {
          cells: key.map((formula) => formula.map((row) => row.map(mark))),
          reference: table.valuations.map((row) => row.map(mark)),
          validity: ["T", "T", "T", "T"],
        },
        exerciseId: "rv1",
      },
      passthroughTranslator,
    );
    expect(html).toContain("⊢");
    expect(html).toContain("tt-turnstile");
    expect(html).toContain("tt-correct");
  });

  test("review escapes the translated verdict text", () => {
    const table = resolveTable(modusPonens.formulas);
    if (table === null) {
      throw new Error("table failed to resolve");
    }
    const key = correctCells(table);
    const mark = (value: boolean): "T" | "F" => (value ? "T" : "F");
    // A catalog is *data*, not source: some locale may word "Correct" with a
    // quote or an angle bracket in it. The verdict lands in a
    // screen-reader-only span, so markup it broke would fail silently — the
    // cell's colour would still look right to a sighted reviewer.
    const hostile: Translator = {
      locale: passthroughTranslator.locale,
      t: (id, values, options) =>
        id === "Correct (truth-table cell)"
          ? '"><b>ok</b>'
          : passthroughTranslator.t(id, values, options),
    };
    const html = renderTruthTableReview(
      modusPonens,
      {
        answer: {
          cells: key.map((formula) => formula.map((row) => row.map(mark))),
          reference: table.valuations.map((row) => row.map(mark)),
          validity: ["T", "T", "T", "T"],
        },
        exerciseId: "rv-escape",
      },
      hostile,
    );
    expect(html).toContain(
      '<span class="visually-hidden">&quot;&gt;&lt;b&gt;ok&lt;/b&gt;</span>',
    );
    // Nothing of the payload survives as markup, and the cell that holds it is
    // still a well-formed graded cell.
    expect(html).not.toContain("<b>");
    expect(html).toContain('<span class="tt-correct" data-tt-value="T">');
  });

  test("normalize preserves the turnstile column; wrong length is rejected", async () => {
    const handler = new TruthTableExerciseHandler();
    const item = (
      await compileArtifact(
        directive('#v2 variant="validity"', "P, P -> Q :|-: Q"),
      )
    ).manifest[0] as ExerciseManifestItem;

    // Build a correctly-shaped blank answer from the resolved table.
    const table = resolveTable(["P", "(P -> Q)", "Q"]);
    if (table === null) {
      throw new Error("table failed to resolve");
    }
    const shaped: TruthTableAnswerData = {
      cells: table.formulas.map((formula) =>
        table.valuations.map(() => formula.cells.map(() => "")),
      ),
      reference: table.valuations.map((row) => row.map(() => "")),
      validity: ["T", "T", "T", "T"],
    };

    const good = handler.normalizeAnswer(
      {
        data: shaped as unknown as Record<string, unknown>,
        kind: TRUTH_TABLE_ANSWER_KIND,
        schemaVersion: TRUTH_TABLE_SCHEMA_VERSION,
      } as never,
      item,
    );
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect((good.answer.data as { validity?: string[] }).validity).toEqual([
        "T",
        "T",
        "T",
        "T",
      ]);
    }

    const shortColumn = handler.normalizeAnswer(
      {
        data: { ...shaped, validity: ["T", "T"] } as unknown as Record<
          string,
          unknown
        >,
        kind: TRUTH_TABLE_ANSWER_KIND,
        schemaVersion: TRUTH_TABLE_SCHEMA_VERSION,
      } as never,
      item,
    );
    expect(shortColumn.ok).toBe(false);
  });
});

describe("truth-table partial", () => {
  // `P /\ Q` lays out as [P, /\, Q]; atoms sort to [P, Q]. A partial answer is a
  // single free row: reference [[P, Q]], cells [[[P, /\, Q]]].
  const conj: TruthTablePublicData = {
    formulas: ["(P /\\ Q)"],
    options: DEFAULT_OPTIONS,
    promptHtml: "",
    variant: "partial",
  };

  test("accepts any correctly filled row when there are no givens", () => {
    // P=T, Q=F → P/\Q = F.
    const grade = gradeTruthTable(conj, {
      cells: [[["T", "F", "F"]]],
      reference: [["T", "F"]],
    });
    expect(grade?.allCorrect).toBe(true);
    expect(grade?.partial).toEqual({
      consistentWithGiven: true,
      filledCorrectly: true,
      hasGivens: false,
    });
    expect(grade && truthTableScoreFraction(grade, "all-or-nothing")).toBe(1);
  });

  test("a wrong cell earns partial credit without givens", () => {
    // /\ should be F for P=T, Q=F.
    const grade = gradeTruthTable(conj, {
      cells: [[["T", "T", "F"]]],
      reference: [["T", "F"]],
    });
    expect(grade?.allCorrect).toBe(false);
    expect(grade?.correctCount).toBe(2);
    expect(grade?.fillableCount).toBe(3);
    expect(grade && truthTableScoreFraction(grade, "partial")).toBeCloseTo(
      2 / 3,
    );
  });

  test("an incomplete valuation is not filled correctly", () => {
    const grade = gradeTruthTable(conj, {
      cells: [[["T", "", ""]]],
      reference: [["T", ""]],
    });
    expect(grade?.partial?.filledCorrectly).toBe(false);
    expect(grade?.correctCount).toBe(0);
  });

  test("compiles givens from a trailing grid", async () => {
    const artifact = await compileArtifact(
      directive(
        '#p-given variant="partial" options="hiddenGivens"',
        "Make Q -> P true, assuming Q is true.\n\n- Q -> P\n\n. T | . T .",
      ),
    );
    const data = publicDataOf(artifact.manifest[0] as ExerciseManifestItem);
    expect(data.variant).toBe("partial");
    expect(data.options.hiddenGivens).toBe(true);
    // atoms [P, Q]; reference pins Q=T. `Q -> P` lays out [Q, ->, P]; the -> is
    // pinned T.
    expect(data.givens).toEqual([
      { cells: [["", "T", ""]], reference: ["", "T"] },
    ]);
  });

  test("givens accept a matching row and reject a non-matching one", async () => {
    const artifact = await compileArtifact(
      directive('#p-assume variant="partial"', "- Q -> P\n\n. T | . T ."),
    );
    const data = publicDataOf(artifact.manifest[0] as ExerciseManifestItem);
    // Row P=T, Q=T satisfies the given (Q true, Q->P true).
    const accepted = gradeTruthTable(data, {
      cells: [[["T", "T", "T"]]],
      reference: [["T", "T"]],
    });
    expect(accepted?.allCorrect).toBe(true);

    // The trivial Q=F row fills correctly (F->F = T) but violates the given.
    const rejected = gradeTruthTable(data, {
      cells: [[["F", "T", "F"]]],
      reference: [["F", "F"]],
    });
    expect(rejected?.partial?.filledCorrectly).toBe(true);
    expect(rejected?.partial?.consistentWithGiven).toBe(false);
    expect(rejected?.allCorrect).toBe(false);
    // A given makes the row all-or-nothing even under partial grading.
    expect(rejected && truthTableScoreFraction(rejected, "partial")).toBe(0);
  });

  test("multiple given rows are alternatives (inequivalence witness)", async () => {
    const artifact = await compileArtifact(
      directive(
        '#p-ineq variant="partial" options="hiddenGivens"',
        "- P /\\ Q, P \\/ Q\n\n. . | . F . | . T .\n. . | . T . | . F .",
      ),
    );
    const data = publicDataOf(artifact.manifest[0] as ExerciseManifestItem);
    expect(data.givens?.length).toBe(2);
    // P=T, Q=F: conj F, disj T — matches the first given row.
    const witness = gradeTruthTable(data, {
      cells: [[["T", "F", "F"]], [["T", "T", "F"]]],
      reference: [["T", "F"]],
    });
    expect(witness?.allCorrect).toBe(true);
    // P=T, Q=T: conj T, disj T — matches neither given row.
    const nonWitness = gradeTruthTable(data, {
      cells: [[["T", "T", "T"]], [["T", "T", "T"]]],
      reference: [["T", "T"]],
    });
    expect(nonWitness?.partial?.consistentWithGiven).toBe(false);
    expect(nonWitness?.allCorrect).toBe(false);
  });

  test("a partial given may pin an interior (non-main) cell", async () => {
    // `~P -> Q` lays out [~, P, ->, Q]; the ~ cell is interior. Pin ~ = T.
    const artifact = await compileArtifact(
      directive(
        '#p-interior variant="partial"',
        "- ~P -> Q\n\n. . | T . . .",
      ),
    );
    const data = publicDataOf(artifact.manifest[0] as ExerciseManifestItem);
    expect(data.givens).toEqual([
      { cells: [["T", "", "", ""]], reference: ["", ""] },
    ]);
    // A row with P=F makes ~P true → the ~ cell is T, matching the given.
    const ok = gradeTruthTable(data, {
      cells: [[["T", "F", "F", "F"]]],
      reference: [["F", "F"]],
    });
    expect(ok?.partial?.consistentWithGiven).toBe(true);
    // A row with P=T makes ~P false → the given is not satisfied.
    const no = gradeTruthTable(data, {
      cells: [[["F", "T", "T", "T"]]],
      reference: [["T", "T"]],
    });
    expect(no?.partial?.consistentWithGiven).toBe(false);
  });

  test("rejects malformed and mis-sized grid rows", async () => {
    // A token that is not T, F, or '.'.
    expect(
      await compileCodes(
        directive('#p-e1 variant="partial"', "- P /\\ Q\n\n. . | . X ."),
      ),
    ).toContain("invalid_grid_token");
    // Too many `|`-separated segments for the formula count.
    expect(
      await compileCodes(
        directive(
          '#p-e2 variant="partial"',
          "- P /\\ Q\n\n. . | . T . | . T .",
        ),
      ),
    ).toContain("given_row_arity");
    // Wrong token count within a formula segment.
    expect(
      await compileCodes(
        directive('#p-e3 variant="partial"', "- P /\\ Q\n\n. . | . T"),
      ),
    ).toContain("given_cell_arity");
  });

  test("renders a single body row (not the full 2ⁿ table)", async () => {
    const artifact = await compileArtifact(
      directive('#p-render variant="partial"', "- P /\\ Q"),
    );
    const html = renderCompiledContent(artifact, i18nFor("en"));
    // Header row + exactly one body row for the whole grid.
    expect((html.match(/<tr/g) ?? []).length).toBe(2);
  });

  test("freezes a lone visible given under strictGivens", async () => {
    // `strictGivens` is the Carnap synonym that folds into `immutable`.
    const artifact = await compileArtifact(
      directive(
        '#p-strict variant="partial" options="strictGivens"',
        "- Q -> P\n\n. T | . . .",
      ),
    );
    const html = renderCompiledContent(artifact, i18nFor("en"));
    // The pinned Q reference cell is frozen: an inert given span, not a button.
    expect(html).toContain(
      '<span class="tt-given" data-tt-role="reference" data-tt-row="0" data-tt-atom="1" data-tt-value="T">T</span>',
    );
  });

  test("review notes a correct partial row", () => {
    const publicData: TruthTablePublicData = {
      formulas: ["(P /\\ Q)"],
      options: DEFAULT_OPTIONS,
      promptHtml: "",
      variant: "partial",
    };
    const html = renderTruthTableReview(
      publicData,
      {
        answer: { cells: [[["T", "F", "F"]]], reference: [["T", "F"]] },
        exerciseId: "p-review",
      },
      passthroughTranslator,
    );
    expect(html).toContain("That row is correct.");
    expect((html.match(/<tr/g) ?? []).length).toBe(2);
  });
});

describe("truth-table given grid (simple/validity)", () => {
  // The fully-correct full-table answer derived from the computed key.
  function fullCorrectAnswer(
    data: TruthTablePublicData,
  ): TruthTableAnswerData {
    const table = resolveTable(data.formulas);
    if (table === null) {
      throw new Error("table failed to resolve");
    }
    const key = correctCells(table);
    const cell = (b: boolean): "T" | "F" => (b ? "T" : "F");
    return {
      cells: table.formulas.map((_formula, fi) =>
        table.valuations.map((_row, ri) => (key[fi]?.[ri] ?? []).map(cell)),
      ),
      reference: table.valuations.map((row) => row.map(cell)),
    };
  }

  test("a strict given is inert and ungraded", async () => {
    // `P -> Q`: 4 rows, cells [P, ->, Q]. Seed the -> cell of the P=T,Q=F row
    // (row index 1 in canonical order). F is the key there.
    const artifact = await compileArtifact(
      directive('#g-imm options="strictGivens"', "- P -> Q\n\nT F | . F ."),
    );
    const data = publicDataOf(artifact.manifest[0] as ExerciseManifestItem);
    const html = renderCompiledContent(artifact, i18nFor("en"));
    expect(html).toContain(
      '<span class="tt-given" data-tt-role="cell" data-tt-formula="0" data-tt-row="1" data-tt-cell="1" data-tt-value="F">F</span>',
    );
    // The locked cell is not graded, so the fillable count is one below the
    // all-open table's 20 (8 reference + 12 formula cells).
    const grade = gradeTruthTable(data, fullCorrectAnswer(data));
    expect(grade?.allCorrect).toBe(true);
    expect(grade?.fillableCount).toBe(19);
  });

  test("an editable given is prefilled but graded", async () => {
    const artifact = await compileArtifact(
      directive("#g-edit", "- P -> Q\n\nT F | . F ."),
    );
    const data = publicDataOf(artifact.manifest[0] as ExerciseManifestItem);
    const html = renderCompiledContent(artifact, i18nFor("en"));
    // Prefilled as an editable button (not an inert span), carrying F — and named
    // for a screen reader, which the glyph alone cannot do.
    expect(html).toContain(
      '<button class="tt-cell" type="button" disabled tabindex="-1" data-tt-role="cell" data-tt-formula="0" data-tt-row="1" data-tt-cell="1" data-tt-value="F" aria-label="-&gt;, row 2: false" data-tt-name="-&gt;">F</button>',
    );
    // Flipping that given cell to T (the key is F) is marked wrong; it still
    // counts toward the full 20 fillable cells.
    const correct = fullCorrectAnswer(data);
    const cells = correct.cells.map((formula, fi) =>
      formula.map((row, ri) =>
        row.map((value, ci) =>
          fi === 0 && ri === 1 && ci === 1 ? ("T" as const) : value,
        ),
      ),
    );
    const grade = gradeTruthTable(data, {
      cells,
      reference: correct.reference,
    });
    expect(grade?.allCorrect).toBe(false);
    expect(grade?.fillableCount).toBe(20);
  });

  test("sparse seeding gives only the listed cell", async () => {
    const artifact = await compileArtifact(
      directive(
        '#g-sparse options="strictGivens"',
        "- P -> Q\n\nT F | . F .",
      ),
    );
    const html = renderCompiledContent(artifact, i18nFor("en"));
    // Exactly one given cell across the whole table (no autoAtoms spans either).
    expect((html.match(/<span class="tt-given"/g) ?? []).length).toBe(1);
  });

  test("immutable is recognized but inert (deferred display-table flag)", async () => {
    // Carnap's `immutable` locks the whole table for display; not yet
    // implemented, so it compiles without error and does not lock givens.
    const artifact = await compileArtifact(
      directive(
        '#g-imm-inert options="immutable"',
        "- P -> Q\n\nT F | . F .",
      ),
    );
    const html = renderCompiledContent(artifact, i18nFor("en"));
    expect((html.match(/<span class="tt-given"/g) ?? []).length).toBe(0);
    expect(html).toContain(
      'data-tt-cell="1" data-tt-value="F" aria-label="-&gt;, row 2: false" data-tt-name="-&gt;">F</button>',
    );
  });

  test("a given conflicting with the key is rejected", async () => {
    // P=T,Q=F makes P->Q false; claiming the -> is T conflicts with the key.
    expect(
      await compileCodes(directive("#g-conf", "- P -> Q\n\nT F | . T .")),
    ).toContain("given_conflicts_with_key");
  });

  test("a wildcard given whose key varies across matched rows is rejected", async () => {
    // `T . | . T .` matches both P=T rows; the -> is T for P=T,Q=T but F for
    // P=T,Q=F, so the constant pin cannot hold.
    expect(
      await compileCodes(directive("#g-wild", "- P -> Q\n\nT . | . T .")),
    ).toContain("given_conflicts_with_key");
  });

  test("a wildcard given consistent across matched rows compiles", async () => {
    // Every P=F row makes P->Q true, so the wildcard pin is safe.
    const artifact = await compileArtifact(
      directive("#g-wild-ok", "- P -> Q\n\nF . | . T ."),
    );
    const data = publicDataOf(artifact.manifest[0] as ExerciseManifestItem);
    expect(data.givens?.length).toBe(1);
  });

  test("trueMark/falseMark change rendering, not the answer data", async () => {
    const artifact = await compileArtifact(
      directive(
        '#g-mark trueMark="1" falseMark="0" options="autoAtoms"',
        "- P -> Q",
      ),
    );
    const data = publicDataOf(artifact.manifest[0] as ExerciseManifestItem);
    expect(data.options.trueMark).toBe("1");
    expect(data.options.falseMark).toBe("0");
    const html = renderCompiledContent(artifact, i18nFor("en"));
    // autoAtoms prefills the reference cells: they render 1/0 while the
    // underlying data-tt-value stays canonical T/F.
    expect(html).toContain('data-tt-value="T">1<');
    expect(html).toContain('data-tt-value="F">0<');
  });

  test("double-turnstile renders ⊨ in a validity header", async () => {
    const artifact = await compileArtifact(
      directive(
        '#g-turn variant="validity" options="double-turnstile"',
        "P :|-: Q",
      ),
    );
    const data = publicDataOf(artifact.manifest[0] as ExerciseManifestItem);
    expect(data.options.turnstileGlyph).toBe("double");
    const html = renderCompiledContent(artifact, i18nFor("en"));
    expect(html).toContain("⊨");
    expect(html).not.toContain("⊢");
  });

  test("negated-double-turnstile renders ⊭", async () => {
    const artifact = await compileArtifact(
      directive(
        '#g-turn2 variant="validity" options="negated-double-turnstile"',
        "P :|-: Q",
      ),
    );
    const html = renderCompiledContent(artifact, i18nFor("en"));
    expect(html).toContain("⊭");
  });
});

describe("renderTruthTableReview", () => {
  test("marks incorrect cells red", () => {
    const publicData: TruthTablePublicData = {
      formulas: ["(P -> P)"],
      options: DEFAULT_OPTIONS,
      promptHtml: "",
      variant: "simple",
    };
    const html = renderTruthTableReview(
      publicData,
      {
        answer: {
          cells: [
            [
              ["T", "F", "T"],
              ["F", "T", "F"],
            ],
          ],
          reference: [["T"], ["F"]],
        },
        exerciseId: "r1",
      },
      passthroughTranslator,
    );
    expect(html).toContain("tt-incorrect");
    expect(html).toContain("tt-correct");
  });

  test("renders a counterexample submission with a validity note", () => {
    const publicData: TruthTablePublicData = {
      formulas: ["(P -> Q)"],
      options: DEFAULT_OPTIONS,
      promptHtml: "",
      variant: "simple",
    };
    const html = renderTruthTableReview(
      publicData,
      {
        answer: {
          cells: [
            [
              ["", "", ""],
              ["T", "F", "F"],
              ["", "", ""],
              ["", "", ""],
            ],
          ],
          counterexample: 1,
          reference: [
            ["", ""],
            ["T", "F"],
            ["", ""],
            ["", ""],
          ],
        },
        exerciseId: "r2",
      },
      passthroughTranslator,
    );
    expect(html).toContain("Valid counterexample.");
    expect(html).toContain("tt-ce-row");
  });
});

describe("truth-table keyboard navigation", () => {
  test("the grid is one tab stop, not one per cell", async () => {
    const artifact = await compileArtifact(directive("#k1", "- P -> Q"));
    const html = renderCompiledContent(artifact, i18nFor("en"));
    const cells = html.match(/<button class="tt-cell"[^>]*>/g) ?? [];

    // 4 rows × (2 atoms + 3 formula cells).
    expect(cells.length).toBe(20);

    // Every cell is skipped by Tab; the client promotes whichever one holds
    // focus, so the whole grid costs one press instead of twenty.
    for (const cell of cells) {
      expect(cell).toContain('tabindex="-1"');
    }

    expect(html).not.toContain('tabindex="0"');
  });

  test("the grid describes its own keys for a reader who cannot see it", async () => {
    const artifact = await compileArtifact(directive("#k2", "- P -> Q"));
    const html = renderCompiledContent(artifact, i18nFor("en"));

    expect(html).toContain('<table class="tt" aria-describedby="tt-keys">');
    expect(html).toContain(
      '<p class="visually-hidden" id="tt-keys">Arrow keys move between cells. Space or Enter changes one.</p>',
    );
  });

  test("a reviewed table has neither tab stops to manage nor keys to describe", async () => {
    const artifact = await compileArtifact(directive("#k3", "- P -> Q"));
    const publicData = publicDataOf(
      artifact.manifest[0] as ExerciseManifestItem,
    );
    const blank: TruthTableAnswerData = {
      cells: [
        Array.from({ length: 4 }, () => ["", "", ""] as const).map((row) => [
          ...row,
        ]),
      ],
      reference: Array.from({ length: 4 }, () => ["", ""]),
    };
    const html = renderTruthTableReview(
      publicData,
      { answer: blank, exerciseId: "k3" },
      passthroughTranslator,
    );

    // Review cells are inert spans: nothing to focus, nothing to arrow between.
    expect(html).not.toContain("aria-describedby");
    expect(html).not.toContain("<button");
  });
});
