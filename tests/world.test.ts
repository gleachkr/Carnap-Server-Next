import { describe, expect, test } from "bun:test";
import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import type { ExerciseManifestItem } from "../src/worker/domain/content";
import type { JsonValue } from "../src/worker/domain/json";
import {
  parseFormula,
  parseFormulaTree,
  satisfiers,
} from "../src/worker/exercise-kit/formula";
import { withSystemText } from "../src/worker/exercise-kit/systems/join";
import { MODEL_EXERCISE } from "../src/worker/exercises/model";
import { WORLD_EXERCISE } from "../src/worker/exercises/world";
import { resolveWorld } from "../src/worker/exercises/world/grading";
import type {
  Block,
  BlocksState,
} from "../src/worker/exercises/world/kinds/blocks";
import { BLOCKS_KIND } from "../src/worker/exercises/world/kinds/blocks";
import { truthValues } from "../src/worker/exercises/world/logic/check";
import {
  bindVocabulary,
  worldStructure,
} from "../src/worker/exercises/world/logic/structure";
import { buildWorldStrings } from "../src/worker/exercises/world/strings";
import type { WorldPublicData } from "../src/worker/exercises/world/types";
import {
  WORLD_ANSWER_KIND,
  WORLD_SCHEMA_VERSION,
} from "../src/worker/exercises/world/types";
import { i18nFor } from "../src/worker/i18n";
import {
  formatMessage,
  passthroughTranslator,
  stringsResolver,
} from "../src/worker/i18n/translator";
import { roleIndex } from "../src/worker/logic/specs/roles";
import {
  BLOCKS_SPEC_SOURCE,
  blocksLanguage,
} from "./helpers/blocks-language";

const LANGUAGE_BLOCK = `:::aufbau-mm0{name="blocks-lpl"}\n${BLOCKS_SPEC_SOURCE}:::\n\n`;

function directive(attrs: string, body: string): string {
  return `${LANGUAGE_BLOCK}::::world{system="blocks-lpl" ${attrs}}\n${body}\n::::`;
}

async function compileCodes(source: string): Promise<string[]> {
  const result = await compileCarnapMarkdown(source);
  return result.diagnostics.map((d) => d.code);
}

async function declaration(source: string): Promise<ExerciseManifestItem> {
  const result = await compileCarnapMarkdown(source);

  if (!result.ok) {
    throw new Error(
      `compile failed: ${result.diagnostics.map((d) => d.code).join(", ")}`,
    );
  }

  const item = result.artifact.manifest[0] as ExerciseManifestItem;

  return {
    ...item,
    publicData: withSystemText(item.publicData, result.artifact.systems),
  };
}

function publicDataOf(item: ExerciseManifestItem): WorldPublicData {
  return item.publicData as unknown as WorldPublicData;
}

async function grade(
  item: ExerciseManifestItem,
  data: JsonValue,
): Promise<{ score: number; status: string; summary: string }> {
  const normalized = WORLD_EXERCISE.normalizeAnswer(
    { data, kind: WORLD_ANSWER_KIND, schemaVersion: WORLD_SCHEMA_VERSION },
    item,
  );

  if (!normalized.ok) {
    throw new Error(`answer refused: ${normalized.reason}`);
  }

  const evaluation = await WORLD_EXERCISE.evaluate(normalized.answer, item, {
    now: new Date("2026-01-01T00:00:00Z"),
  } as never);
  const review = WORLD_EXERCISE.reviewAnswer(normalized.answer, item, {
    audience: "student",
    i18n: passthroughTranslator,
  } as never);

  return {
    score: evaluation.awardedScore,
    status: evaluation.status,
    summary: review.summary,
  };
}

function block(
  id: string,
  shape: Block["shape"],
  size: Block["size"],
  col: number,
  row: number,
  names: string[] = [],
): Block {
  return { col, id, names, row, shape, size };
}

function world(...objects: Block[]): BlocksState {
  return { kind: "blocks@1", objects };
}

describe("namespaced roles", () => {
  test("a dotted role is not a core role, and is listed by namespace", () => {
    const index = roleIndex(blocksLanguage());

    expect(index.roleOf("Cube")).toBeNull();
    expect(index.roleOf("and")).toBe("conjunction");
    expect(index.rolesIn("blocks").get("blocks.left-of")).toBe("LeftOf");
    expect(index.rolesIn("blocks").size).toBe(18);
  });

  test("the model reads a blocks predicate as an ordinary predicate", async () => {
    const result = await compileCarnapMarkdown(
      `${LANGUAGE_BLOCK}::::model{#m system="blocks-lpl"}\n- ∃x(Cube(x) ∧ LeftOf(x, a))\n::::`,
    );

    expect(result.diagnostics).toEqual([]);
    expect(MODEL_EXERCISE.kind).toBe("model@1");
  });

  test("canonical text reads back, which the stored form depends on", () => {
    const lang = blocksLanguage();
    const parsed = parseFormula("∀x(Cube(x) → ∃y LeftOf(y,x))", lang);

    expect(parsed.ok).toBe(true);
    expect(
      parseFormulaTree("∀x(Cube(x) → ∃yLeftOf(y,x))", lang),
    ).not.toBeNull();
  });
});

describe("the blocks vocabulary", () => {
  const lang = blocksLanguage();
  const vocabulary = bindVocabulary(BLOCKS_KIND, lang);
  const state = world(
    block("o1", "tet", "small", 1, 1, ["a"]),
    block("o2", "cube", "medium", 3, 1, ["b"]),
    block("o3", "dodec", "large", 3, 3, ["c"]),
    block("o4", "cube", "large", 2, 1, ["d"]),
    block("o5", "tet", "medium", 5, 5, ["e"]),
    block("o6", "dodec", "small", 4, 2, ["f"]),
  );

  test("binds every role and reports nothing", () => {
    expect(vocabulary.problems).toEqual([]);
    expect(vocabulary.symbols.size).toBe(18);
  });

  const cases: readonly [string, boolean][] = [
    ["Tet(a)", true],
    ["Cube(a)", false],
    ["Dodec(c)", true],
    ["Small(a)", true],
    ["Medium(b)", true],
    ["Large(c)", true],
    ["Smaller(a,b)", true],
    ["Smaller(b,a)", false],
    ["Larger(c,b)", true],
    ["SameSize(c,d)", true],
    ["SameSize(a,a)", true],
    ["SameShape(b,d)", true],
    ["LeftOf(a,b)", true],
    ["LeftOf(b,a)", false],
    ["RightOf(b,a)", true],
    ["BackOf(b,c)", true],
    ["FrontOf(c,b)", true],
    ["SameRow(a,b)", true],
    ["SameCol(b,c)", true],
    ["Adjoins(a,d)", true],
    ["Adjoins(d,b)", true],
    ["Adjoins(a,b)", false],
    ["Adjoins(c,f)", false],
    ["Between(d,a,b)", true],
    ["Between(a,d,b)", false],
    ["Between(f,b,c)", false],
    ["Between(c,a,e)", true],
    ["Between(f,b,e)", false],
    ["Between(c,f,e)", false],
  ];

  for (const [source, expected] of cases) {
    test(`${source} is ${expected}`, () => {
      const parsed = parseFormula(source, lang);

      if (!parsed.ok) {
        throw new Error(`does not parse: ${source}`);
      }

      const { structure } = worldStructure(BLOCKS_KIND, state, vocabulary);
      expect(satisfiers(parsed.formula, structure, []).length > 0).toBe(
        expected,
      );
    });
  }

  test("a diagonal between holds", () => {
    const diagonal = world(
      block("o1", "cube", "small", 2, 2, ["a"]),
      block("o2", "cube", "small", 1, 1, ["b"]),
      block("o3", "cube", "small", 4, 4, ["c"]),
    );
    const parsed = parseFormula("Between(a,b,c)", lang);

    if (!parsed.ok) {
      throw new Error("does not parse");
    }

    expect(
      satisfiers(
        parsed.formula,
        worldStructure(BLOCKS_KIND, diagonal, vocabulary).structure,
        [],
      ),
    ).toHaveLength(1);
  });
});

describe("the blocks kind", () => {
  const start = world(
    block("o1", "tet", "small", 1, 1, ["a"]),
    block("o2", "cube", "large", 4, 3, ["b"]),
  );

  test("refuses a move onto an occupied square, with the reason", () => {
    const result = BLOCKS_KIND.apply(start, {
      col: 4,
      id: "o1",
      row: 3,
      type: "move",
    });

    expect(BLOCKS_KIND.isRefusal(result)).toBe(true);
    expect(
      BLOCKS_KIND.describeProblem(start, result as never, (id, values) =>
        formatMessage(id, values),
      ),
    ).toBe("Column 4, row 3 already holds b.");
  });

  describe("a sentence about an unnamed block is worded whole", () => {
    const english = (id: string, values?: Readonly<Record<string, string>>) =>
      formatMessage(id, values);
    const unnamed = world(
      block("o1", "tet", "small", 1, 1, ["a"]),
      block("o2", "dodec", "large", 5, 6),
    );

    test("opening a sentence, it is capitalized", () => {
      expect(
        BLOCKS_KIND.describeMove(
          unnamed,
          { id: "o2", size: "small", type: "size" },
          english,
        ),
      ).toBe("The block at column 5, row 6 is now a small dodec.");
      expect(
        BLOCKS_KIND.objectSentence(unnamed, "o2", "pinned", english),
      ).toBe("The block at column 5, row 6 is pinned and cannot be changed.");
    });

    test("a move names both squares", () => {
      expect(
        BLOCKS_KIND.describeMove(
          unnamed,
          { col: 2, id: "o2", row: 3, type: "move" },
          english,
        ),
      ).toBe("Moved the block at column 5, row 6 to column 2, row 3.");
    });

    test("an occupied square is not named twice", () => {
      const result = BLOCKS_KIND.apply(unnamed, {
        col: 5,
        id: "o1",
        row: 6,
        type: "move",
      });

      expect(
        BLOCKS_KIND.describeProblem(unnamed, result as never, english),
      ).toBe("Column 5, row 6 already holds a block.");
    });

    test("a named block is still referred to by its name", () => {
      expect(
        BLOCKS_KIND.objectSentence(unnamed, "o1", "put-back", english),
      ).toBe("Put a back.");
    });

    test("the translation decides where the square goes", () => {
      const german = stringsResolver(buildWorldStrings(i18nFor("de")));

      expect(
        BLOCKS_KIND.describeMove(
          unnamed,
          { id: "o2", type: "remove" },
          german,
        ),
      ).toMatch(/^Der Block in Spalte 5, Zeile 6 /);
    });
  });

  test("refuses a name another block has", () => {
    const result = BLOCKS_KIND.apply(start, {
      id: "o2",
      names: ["a"],
      type: "names",
    });

    expect(BLOCKS_KIND.isRefusal(result)).toBe(true);
  });

  test("counts changed blocks, not changed attributes", () => {
    const next = world(
      block("o1", "cube", "large", 2, 2, ["a"]),
      block("o2", "cube", "large", 4, 3, ["b"]),
      block("n1", "dodec", "small", 8, 8),
    );

    expect(BLOCKS_KIND.distance(start, next)).toBe(2);
    expect(BLOCKS_KIND.pinViolations(start, next, new Set(["o1"]))).toEqual([
      "o1",
    ]);
  });

  test("reads and writes an object line", () => {
    const spec = BLOCKS_KIND.parseObject("cube LARGE at 3, 5 named a, b");

    expect(spec).toEqual({
      col: 3,
      names: ["a", "b"],
      row: 5,
      shape: "cube",
      size: "large",
    });
    expect(
      BLOCKS_KIND.formatObject(BLOCKS_KIND.build([spec as never]), "o1"),
    ).toBe("large cube at 3,5 named a, b");
    expect(BLOCKS_KIND.parseObject("huge cube at 3,5")).toMatchObject({
      code: "object-attribute",
    });
  });

  test("a state of the wrong shape is not a state", () => {
    expect(BLOCKS_KIND.parseState({ kind: "blocks@1", objects: [{}] })).toBe(
      null,
    );
    expect(
      BLOCKS_KIND.parseState({
        kind: "blocks@1",
        objects: [block("o1", "cube", "small", 9, 1)],
      }),
    ).toBe(null);
  });
});

describe("compiling a world directive", () => {
  const BUILD = directive(
    '#lefty budget="2" points="3"',
    [
      "Change at most two blocks.",
      "",
      "- ∀x(Cube(x) → ∃y LeftOf(y,x))",
      "- false: ∃x Large(x)",
      "",
      "| law : ∀x∀y(SameRow(x,y) → x = y)",
      "| pinned block : small tet at 1,1 named a",
      "| block : large cube at 4,3 named b",
      "| block : medium dodec at 6,7",
    ].join("\n"),
  );

  test("stores sentences as engine text, with targets, laws, pins, and the start", async () => {
    const data = publicDataOf(await declaration(BUILD));

    expect(data.variant).toBe("build");
    expect(data.world).toBe("blocks");
    expect(data.sentences).toEqual([
      {
        engine: "( ∀ x ( ( Cube ( x ) ) → ( ∃ y ( LeftOf ( y , x ) ) ) ) )",
        target: true,
      },
      { engine: "( ∃ x ( Large ( x ) ) )", target: false },
    ]);
    expect(data.laws).toEqual([
      "( ∀ x ( ∀ y ( ( SameRow ( x , y ) ) → ( x = y ) ) ) )",
    ]);

    // A reader is shown the language's own spelling, worked out on reading.
    const resolved = resolveWorld(data);
    expect(resolved?.sentences.map((sentence) => sentence.text)).toEqual([
      "∀x(Cube(x) → ∃yLeftOf(y,x))",
      "∃xLarge(x)",
    ]);
    expect(resolved?.laws.map((law) => law.text)).toEqual([
      "∀x∀y(SameRow(x,y) → x=y)",
    ]);
    expect(data.pinned).toEqual(["o1"]);
    expect(data.budget).toBe(2);
    expect(BLOCKS_KIND.parseState(data.start)?.objects).toHaveLength(3);
  });

  test("needs a system, since no built-in language has blocks", async () => {
    expect(await compileCodes("::::world{#w}\n- ∃x Cube(x)\n::::")).toContain(
      "missing_system",
    );
  });

  test("refuses a symbol the world gives no meaning, at its arity", async () => {
    expect(await compileCodes(directive("#w", "- LeftOf(a,b,c)"))).toEqual([
      "world_uninterpreted_symbol",
    ]);
  });

  test("refuses a bad object line, a shared square, and an unknown name", async () => {
    expect(
      await compileCodes(
        directive("#w", "- ∃x Cube(x)\n| block : huge cube at 1,1"),
      ),
    ).toEqual(["world_object_attribute"]);
    expect(
      await compileCodes(
        directive(
          "#w",
          "- ∃x Cube(x)\n| block : small cube at 1,1\n| block : small tet at 1,1",
        ),
      ),
    ).toEqual(["world_shared_square"]);
    expect(
      await compileCodes(
        directive("#w", "- ∃x Cube(x)\n| block : small cube at 1,1 named q"),
      ),
    ).toEqual(["world_object_name_unknown"]);
  });

  test("refuses a law false at the start", async () => {
    expect(
      await compileCodes(
        directive(
          "#w",
          "- ∃x Tet(x)\n| law : ∀x Cube(x)\n| block : small tet at 1,1",
        ),
      ),
    ).toEqual(["world_law_false"]);
  });

  test("warns about a build exercise already solved", async () => {
    const result = await compileCarnapMarkdown(
      directive("#w", "- ∃x Cube(x)\n| block : small cube at 1,1"),
    );

    expect(result.ok).toBe(true);
    expect(result.diagnostics.map((d) => [d.code, d.severity])).toEqual([
      ["world_already_solved", "warning"],
    ]);
  });

  test("an evaluate sentence must name something in the world", async () => {
    expect(
      await compileCodes(
        directive(
          '#w variant="evaluate"',
          "- Cube(a)\n| block : small cube at 1,1",
        ),
      ),
    ).toEqual(["world_name_denotes_nothing"]);
  });

  test("distinguish takes worlds A and B and a checked restriction", async () => {
    expect(
      await compileCodes(
        directive(
          '#w variant="distinguish" without="= Purple"',
          "| A block : small cube at 1,1\n| B block : small tet at 1,1",
        ),
      ),
    ).toEqual(["world_restriction_spelling"]);
    expect(
      await compileCodes(
        directive('#w variant="distinguish"', "| block : small cube at 1,1"),
      ),
    ).toEqual(["world_distinguish_worlds"]);
    expect(
      await compileCodes(
        directive(
          '#w variant="distinguish" symbols="∃" without="="',
          "| A block : small cube at 1,1",
        ),
      ),
    ).toEqual(["world_restriction_both"]);
  });
});

describe("grading", () => {
  const BUILD = directive(
    '#lefty budget="2" points="3"',
    [
      "- ∀x(Cube(x) → ∃y LeftOf(y,x))",
      "- false: ∃x Large(x)",
      "| law : ∀x∀y(SameRow(x,y) → x = y)",
      "| pinned block : small tet at 1,1 named a",
      "| block : large cube at 4,3 named b",
      "| block : medium dodec at 6,7",
    ].join("\n"),
  );

  async function buildCase(
    edit: (objects: Block[]) => Block[],
  ): Promise<{ score: number; status: string; summary: string }> {
    const item = await declaration(BUILD);
    const start = BLOCKS_KIND.parseState(publicDataOf(item).start);

    if (start === null) {
      throw new Error("no start");
    }

    return grade(item, {
      world: world(...edit([...start.objects])) as unknown as JsonValue,
    });
  }

  test("a world that does everything scores everything", async () => {
    expect(
      await buildCase((objects) =>
        objects.map((o) =>
          o.id === "o2" ? { ...o, size: "medium" as const } : o,
        ),
      ),
    ).toEqual({
      score: 3,
      status: "correct",
      summary: "This world does everything the exercise asks.",
    });
  });

  test("the start world misses a target", async () => {
    const result = await buildCase((objects) => objects);

    expect(result.score).toBe(0);
    expect(result.summary).toContain("∃xLarge(x)");
  });

  test("a broken pin, a spent budget, and a broken law are zeros with reasons", async () => {
    expect(
      (
        await buildCase((objects) =>
          objects.map((o) =>
            o.id === "o1"
              ? { ...o, col: 2 }
              : o.id === "o2"
                ? { ...o, size: "medium" as const }
                : o,
          ),
        )
      ).summary,
    ).toContain("pinned");
    expect(
      (
        await buildCase((objects) => [
          ...objects.map((o) =>
            o.id === "o2" ? { ...o, size: "small" as const } : o,
          ),
          block("n1", "cube", "small", 8, 8),
          block("n2", "cube", "small", 8, 5),
        ])
      ).summary,
    ).toBe("This world changes 3 objects; the most allowed is 2.");
    expect(
      (
        await buildCase((objects) =>
          objects.map((o) =>
            o.id === "o3"
              ? { ...o, row: 3 }
              : o.id === "o2"
                ? { ...o, size: "small" as const }
                : o,
          ),
        )
      ).summary,
    ).toContain("Not every law holds");
  });

  test("physics is a zero with a reason, not a refused payload", async () => {
    const result = await buildCase((objects) =>
      objects.map((o) => (o.id === "o3" ? { ...o, col: 4, row: 3 } : o)),
    );

    expect(result.status).toBe("incorrect");
    expect(result.summary).toBe(
      "Two blocks share column 4, row 3: b and medium dodec.",
    );
  });

  test("evaluate scores per sentence", async () => {
    const item = await declaration(
      directive(
        '#ev variant="evaluate" points="2"',
        "- Cube(a)\n- ∃x Tet(x)\n| block : small cube at 2,2 named a",
      ),
    );

    expect((await grade(item, { values: [true, false] })).score).toBe(2);
    expect((await grade(item, { values: [true, true] })).score).toBe(1);
    expect((await grade(item, { values: [null] })).score).toBe(0);
  });

  test("distinguish needs true in A, false in B, within the restriction", async () => {
    const item = await declaration(
      directive(
        '#tell variant="distinguish" without="="',
        "| A block : small cube at 2,2\n| A block : small cube at 5,2\n| B block : small cube at 2,2",
      ),
    );

    expect(
      (await grade(item, { sentence: "∃x∃y¬SameCol(x,y)" })).status,
    ).toBe("correct");
    expect((await grade(item, { sentence: "∃x∃y¬x=y" })).summary).toBe(
      "This exercise does not allow =.",
    );
    expect((await grade(item, { sentence: "∃x Cube(x)" })).summary).toBe(
      "The sentence is true in world B.",
    );
    expect((await grade(item, { sentence: "Cube(x)" })).status).toBe(
      "incorrect",
    );
  });

  test("a spelling names every symbol it spells, elab rules included", async () => {
    // Calgary's `E` is the predicate letter E and, through an elab rule,
    // an ASCII ∃: an author who lists `E` means the quantifier too.
    const calgary = [
      ':::aufbau-mm0{name="calgary-blocks" src="/theories/forallx-calgary.mm0"}',
      "--| @syntax delimiter $ LeftOf $",
      "--| @syntax role blocks.left-of",
      "term LeftOf (s: seq): wff;",
      ":::",
      "",
    ].join("\n");
    const worlds = [
      "| A block : small cube at 3,3 named a",
      "| A block : large cube at 6,3",
      "| B block : small cube at 3,3 named a",
      "| B block : large cube at 1,3",
    ].join("\n");
    const exercise = (restriction: string) =>
      declaration(
        `${calgary}::::world{#few system="calgary-blocks" variant="distinguish" ${restriction}}\n${worlds}\n::::`,
      );

    const only = await exercise('symbols="LeftOf ~ E"');

    expect((await grade(only, { sentence: "ExLeftOf(a,x)" })).status).toBe(
      "correct",
    );
    expect((await grade(only, { sentence: "~AxLeftOf(x,a)" })).summary).toBe(
      "This exercise does not allow ∀.",
    );

    const without = await exercise('without="E"');

    expect(
      (await grade(without, { sentence: "ExLeftOf(a,x)" })).summary,
    ).toBe("This exercise does not allow E.");
  });

  test("the live truth values are the grader's", async () => {
    const data = publicDataOf(await declaration(BUILD));
    const resolved = resolveWorld(data);

    if (resolved === null) {
      throw new Error("does not resolve");
    }

    expect(truthValues(resolved, resolved.start)).toEqual({
      laws: [true],
      sentences: [true, true],
    });
  });
});
