import type { SurfaceLanguage } from "@aufbau/syntax";
import {
  type CompilerDiagnostic,
  diagnostic,
} from "../../application/content/diagnostics";
import { renderMarkdownSource } from "../../application/content/markdown";
import type { ExerciseFeedback } from "../../domain/exercises";
import {
  buildCompiledExercise,
  COMMON_EXERCISE_ATTRIBUTES,
  type CompiledExercise,
  type DirectiveBlock,
  parseExamAttribute,
  parsePoints,
  reconcileFeedback,
  requireAttribute,
  validateAttributes,
  validateExerciseId,
} from "../../exercise-kit/authoring";
import type { Formula } from "../../exercise-kit/formula";
import {
  formulaToString,
  freeVariables,
  isArgumentLine,
  parseFormula,
  parseTerm,
  splitArgumentLine,
} from "../../exercise-kit/formula";
import { parseSystemAttribute } from "../../exercise-kit/systems/attribute";
import type { ExerciseCompileContext } from "../../exercise-kit/type";
import type { ResolvedWorld } from "./grading";
import { DEFAULT_WORLD_KIND, WORLD_KINDS, worldKindById } from "./kinds";
import type { WorldKind, WorldProblem } from "./kinds/contract";
import { judgeWorld, truthValues } from "./logic/check";
import { resolveSpelling } from "./logic/restriction";
import type { WorldVocabulary } from "./logic/structure";
import {
  bindVocabulary,
  formulaNames,
  uninterpretedSymbols,
  worldNames,
} from "./logic/structure";
import type {
  WorldPublicData,
  WorldRestriction,
  WorldSentence,
  WorldVariant,
} from "./types";
import {
  readsFixedWorld,
  WORLD_ANSWER_KIND,
  WORLD_CAPABILITIES,
  WORLD_COMPONENT_METADATA,
  WORLD_KIND,
  WORLD_SCHEMA_VERSION,
  WORLD_VARIANTS,
} from "./types";

const LIST_ITEM = /^\s*-\s+(.+?)\s*$/;
const TARGET_PREFIX = /^(true|false)\s*:\s*(.*)$/;

/**
 * A data line: `| key : value`. Keyed on a *leading* `|`, as in the model,
 * because a first-order language may spell disjunction `|` and no sentence
 * can begin with it.
 */
const DATA_LINE = /^\s*\|\s*([^:]+?)\s*:\s*(.*)$/;

function isDataLine(line: string): boolean {
  return /^\s*\|/.test(line);
}

/** What `::::world{…}` accepts beyond the shared exercise set. */
const WORLD_ATTRIBUTES = [
  ...COMMON_EXERCISE_ATTRIBUTES,
  "budget",
  "symbols",
  "system",
  "variant",
  "without",
  "world",
] as const;

/**
 * A game's feedback. Who wins is the game itself, so it cannot be withheld:
 * `none` is refused, and saying nothing means `full` rather than the
 * assignment's default, which is `none` wherever grades are held back.
 * Everything else leaves the feedback as the author wrote it.
 */
function gameFeedback(
  block: DirectiveBlock,
  variant: WorldVariant,
  feedback: ExerciseFeedback | undefined,
  diagnostics: CompilerDiagnostic[],
): ExerciseFeedback | undefined {
  if (variant !== "game") {
    return feedback;
  }

  if (feedback === "none") {
    diagnostics.push(
      diagnostic(
        block.line,
        "world_game_feedback_none",
        'A game exercise cannot hide its feedback, because the game shows who wins. Use feedback="terse" to show only that.',
      ),
    );
  }

  return feedback === "terse" ? "terse" : "full";
}

/** The variants whose student edits the world, and so may be constrained. */
function edits(variant: WorldVariant): boolean {
  return variant === "build" || variant === "counterexample";
}

function parseVariant(
  value: string | undefined,
  line: number,
  diagnostics: CompilerDiagnostic[],
): WorldVariant {
  if (value === undefined) {
    return "build";
  }

  if (WORLD_VARIANTS.includes(value as WorldVariant)) {
    return value as WorldVariant;
  }

  diagnostics.push(
    diagnostic(
      line,
      "unsupported_world_variant",
      "The variant attribute must be evaluate, build, counterexample, distinguish, or game.",
    ),
  );

  return "build";
}

function parseBudget(
  block: DirectiveBlock,
  variant: WorldVariant,
  diagnostics: CompilerDiagnostic[],
): number | undefined {
  const value = block.attrs.budget?.trim();

  if (value === undefined) {
    return undefined;
  }

  if (!edits(variant)) {
    diagnostics.push(
      diagnostic(
        block.line,
        "world_budget_variant",
        "Only a build or counterexample exercise has a budget.",
      ),
    );
    return undefined;
  }

  if (!/^\d{1,3}$/.test(value)) {
    diagnostics.push(
      diagnostic(
        block.line,
        "invalid_world_budget",
        "The budget attribute must be a whole number of objects, 0 or more.",
      ),
    );
    return undefined;
  }

  return Number.parseInt(value, 10);
}

function parseRestriction(
  block: DirectiveBlock,
  variant: WorldVariant,
  language: SurfaceLanguage,
  diagnostics: CompilerDiagnostic[],
): WorldRestriction | undefined {
  const { symbols, without } = block.attrs;

  if (symbols === undefined && without === undefined) {
    return undefined;
  }

  if (variant !== "distinguish") {
    diagnostics.push(
      diagnostic(
        block.line,
        "world_restriction_variant",
        "Only a distinguish exercise takes symbols or without.",
      ),
    );
    return undefined;
  }

  if (symbols !== undefined && without !== undefined) {
    diagnostics.push(
      diagnostic(
        block.line,
        "world_restriction_both",
        "Give symbols or without, not both.",
      ),
    );
    return undefined;
  }

  const spellings = (symbols ?? without ?? "")
    .split(/\s+/)
    .filter((spelling) => spelling.length > 0);

  for (const spelling of spellings) {
    if (resolveSpelling(spelling, language).length === 0) {
      diagnostics.push(
        diagnostic(
          block.line,
          "world_restriction_spelling",
          "The language has no symbol “{symbol}”.",
          { params: { symbol: spelling } },
        ),
      );
    }
  }

  return symbols === undefined
    ? { without: spellings }
    : { symbols: spellings };
}

interface Located {
  readonly line: number;
  readonly text: string;
}

interface WorldBody {
  readonly data: readonly (Located & { readonly key: string })[];
  readonly promptLines: readonly string[];
  /** Build and evaluate sentences, and each one's `true:`/`false:` prefix. */
  readonly items: readonly (Located & { readonly target?: boolean })[];
  /** The counterexample's argument line, if one was written. */
  readonly sequent: Located | null;
}

/**
 * Prose, then sentences (list items, or one `:|-:` line) and `| key : value`
 * data lines in any order. A prompt is the run of lines before the first
 * sentence or data line.
 */
function parseBody(
  block: DirectiveBlock,
  diagnostics: CompilerDiagnostic[],
): WorldBody {
  const promptLines: string[] = [];
  const items: (Located & { target?: boolean })[] = [];
  const data: (Located & { key: string })[] = [];
  let sequent: Located | null = null;
  let pastPrompt = false;

  for (const [index, line] of block.bodyLines.entries()) {
    const lineNumber = block.bodyStartLine + index;

    // Before the data test, because the turnstile itself contains a `|`.
    if (isArgumentLine(line)) {
      pastPrompt = true;

      if (sequent === null) {
        sequent = {
          line: lineNumber,
          text: line.replace(/^\s*-\s+/, ""),
        };
      } else {
        diagnostics.push(
          diagnostic(
            lineNumber,
            "multiple_turnstiles",
            "A validity sequent must contain exactly one ':|-:' turnstile.",
          ),
        );
      }

      continue;
    }

    if (isDataLine(line)) {
      pastPrompt = true;
      const match = DATA_LINE.exec(line);

      if (match === null) {
        diagnostics.push(
          diagnostic(
            lineNumber,
            "invalid_world_line",
            "A world data line is written “| key : value”.",
          ),
        );
      } else {
        data.push({
          key: (match[1] ?? "").trim(),
          line: lineNumber,
          text: (match[2] ?? "").trim(),
        });
      }

      continue;
    }

    const item = LIST_ITEM.exec(line);

    if (item !== null) {
      pastPrompt = true;
      const text = item[1] ?? "";
      const prefix = TARGET_PREFIX.exec(text);

      items.push(
        prefix === null
          ? { line: lineNumber, text }
          : {
              line: lineNumber,
              target: prefix[1] === "true",
              text: prefix[2] ?? "",
            },
      );
      continue;
    }

    if (!pastPrompt) {
      promptLines.push(line);
    } else if (line.trim().length > 0) {
      diagnostics.push(
        diagnostic(
          lineNumber,
          "invalid_world_body",
          "Only sentence list items and | lines may follow the first sentence.",
        ),
      );
    }
  }

  return { data, items, promptLines, sequent };
}

/**
 * The body lines a world exercise reads as data rather than prose, so that a
 * colon in `| block : …` or `false: …` is not reported as a directive.
 */
export function worldDataBodyLines(
  block: DirectiveBlock,
): ReadonlySet<number> {
  const data = new Set<number>();
  let pastPrompt = false;

  for (const [index, line] of block.bodyLines.entries()) {
    pastPrompt ||=
      isDataLine(line) || LIST_ITEM.test(line) || isArgumentLine(line);

    if (pastPrompt) {
      data.add(block.bodyStartLine + index);
    }
  }

  return data;
}

interface SentenceContext {
  readonly diagnostics: CompilerDiagnostic[];
  readonly kind: WorldKind;
  readonly language: SurfaceLanguage;
  readonly vocabulary: WorldVocabulary;
}

/** Parse, check, and canonicalize one sentence; `null` after reporting why not. */
function readSentence(
  source: string,
  line: number,
  context: SentenceContext,
): {
  readonly engine: string;
  readonly formula: Formula;
  readonly text: string;
} | null {
  const trimmed = source.trim();
  const parsed = parseFormula(trimmed, context.language);

  if (!parsed.ok) {
    context.diagnostics.push(
      diagnostic(
        line,
        "invalid_formula",
        "Could not parse formula “{formula}”: {detail}",
        {
          params: {
            detail: parsed.errors[0] ?? { message: "syntax error" },
            formula: trimmed,
          },
        },
      ),
    );
    return null;
  }

  const text = formulaToString(parsed.formula, context.language);
  let ok = true;

  if (freeVariables(parsed.formula).length > 0) {
    context.diagnostics.push(
      diagnostic(
        line,
        "world_open_sentence",
        "“{formula}” has free variables, and a world exercise's sentences must have none.",
        { params: { formula: text } },
      ),
    );
    ok = false;
  }

  for (const symbol of uninterpretedSymbols(
    parsed.formula,
    context.vocabulary,
  )) {
    context.diagnostics.push(
      diagnostic(
        line,
        "world_uninterpreted_symbol",
        "“{symbol}” with {arity} arguments has no meaning in a {world} world. Give it one of the world's roles in the language, or leave it out.",
        {
          params: {
            arity: symbol.arity,
            symbol: symbol.name,
            world: context.kind.id,
          },
        },
      ),
    );
    ok = false;
  }

  return ok ? { engine: parsed.engine, formula: parsed.formula, text } : null;
}

/** The vocabulary's own problems, reported once against the directive. */
function reportVocabulary(
  vocabulary: WorldVocabulary,
  kind: WorldKind,
  line: number,
  diagnostics: CompilerDiagnostic[],
): void {
  for (const problem of vocabulary.problems) {
    switch (problem.code) {
      case "unknown-role":
        diagnostics.push(
          diagnostic(
            line,
            "world_unknown_role",
            "The language uses the role “{role}”, which a {world} world does not have.",
            { params: { role: problem.role, world: kind.id } },
          ),
        );
        break;
      case "not-first-order":
        diagnostics.push(
          diagnostic(
            line,
            "world_role_not_first_order",
            "“{symbol}” has the role “{role}” but does not take individuals as its arguments.",
            { params: { role: problem.role, symbol: problem.symbol } },
          ),
        );
        break;
      default:
        diagnostics.push(
          diagnostic(
            line,
            "world_role_arity",
            "The role “{role}” needs {arity} arguments, but “{symbol}” takes {declared}.",
            {
              params: {
                arity: problem.arity,
                declared: problem.declared,
                role: problem.role,
                symbol: problem.symbol,
              },
            },
          ),
        );
    }
  }
}

function reportObjectProblem(
  problem: WorldProblem,
  source: string,
  line: number,
  diagnostics: CompilerDiagnostic[],
): void {
  const values = problem.values ?? {};

  switch (problem.code) {
    case "object-attribute":
      diagnostics.push(
        diagnostic(
          line,
          "world_object_attribute",
          "“{word}” is not a shape or size this world knows.",
          { params: { word: values.word ?? "" } },
        ),
      );
      return;
    case "object-square":
      diagnostics.push(
        diagnostic(
          line,
          "world_object_square",
          "Column {col}, row {row} is not on the board.",
          { params: { col: values.col ?? "", row: values.row ?? "" } },
        ),
      );
      return;
    default:
      diagnostics.push(
        diagnostic(
          line,
          "world_object_syntax",
          "“{object}” does not read as an object. Write it like “large cube at 3,5 named a, b”.",
          { params: { object: source } },
        ),
      );
  }
}

/** The physics a start world breaks, against the directive. */
function reportPhysics(
  problems: readonly WorldProblem[],
  line: number,
  diagnostics: CompilerDiagnostic[],
): void {
  for (const problem of problems) {
    const values = problem.values ?? {};

    switch (problem.code) {
      case "shared-square":
        diagnostics.push(
          diagnostic(
            line,
            "world_shared_square",
            "Two objects stand on column {col}, row {row}.",
            { params: { col: values.col ?? "", row: values.row ?? "" } },
          ),
        );
        break;
      case "shared-name":
        diagnostics.push(
          diagnostic(
            line,
            "world_shared_name",
            "“{name}” names two objects.",
            { params: { name: values.name ?? "" } },
          ),
        );
        break;
      case "too-many":
        diagnostics.push(
          diagnostic(
            line,
            "world_too_many_objects",
            "A world may hold at most {max} objects.",
            { params: { max: values.max ?? "" } },
          ),
        );
        break;
      default:
        diagnostics.push(
          diagnostic(
            line,
            "world_physics",
            "This world breaks the rules of its kind.",
          ),
        );
    }
  }
}

interface WorldLines {
  readonly lines: readonly (Located & { readonly pinned: boolean })[];
}

/**
 * Read one world's object lines into a state and its pinned ids, checking
 * every name is one the language has.
 */
function readWorld(
  world: WorldLines,
  kind: WorldKind,
  language: SurfaceLanguage,
  diagnostics: CompilerDiagnostic[],
): { readonly state: unknown; readonly pinned: readonly string[] } | null {
  const specs: unknown[] = [];
  const pinnedIndices: number[] = [];
  let ok = true;

  for (const line of world.lines) {
    const spec = kind.parseObject(line.text);

    if (
      typeof spec === "object" &&
      spec !== null &&
      "code" in spec &&
      "objects" in spec
    ) {
      reportObjectProblem(
        spec as WorldProblem,
        line.text,
        line.line,
        diagnostics,
      );
      ok = false;
      continue;
    }

    if (line.pinned) {
      pinnedIndices.push(specs.length);
    }

    specs.push(spec);
  }

  if (!ok) {
    return null;
  }

  const state = kind.build(specs);
  const objects = kind.objects(state);

  for (const [index, object] of objects.entries()) {
    const at = world.lines[index]?.line ?? 0;

    for (const name of object.names) {
      const term = parseTerm(name, language);

      if (
        !term.ok ||
        term.term.type !== "constant" ||
        term.term.name !== name
      ) {
        diagnostics.push(
          diagnostic(
            at,
            "world_object_name_unknown",
            "“{name}” is not a name in this language.",
            { params: { name } },
          ),
        );
        ok = false;
      }
    }
  }

  const problems = kind.problems(state);

  if (problems.length > 0) {
    reportPhysics(problems, world.lines[0]?.line ?? 0, diagnostics);
    ok = false;
  }

  return ok
    ? {
        pinned: pinnedIndices.flatMap((index) => {
          const id = objects[index]?.id;
          return id === undefined ? [] : [id];
        }),
        state,
      }
    : null;
}

/** Sort the data lines into worlds and laws, reporting any key no variant reads. */
function sortData(
  body: WorldBody,
  kind: WorldKind,
  variant: WorldVariant,
  diagnostics: CompilerDiagnostic[],
): {
  readonly a: WorldLines;
  readonly b: WorldLines;
  readonly laws: readonly Located[];
  readonly world: WorldLines;
} {
  const world: (Located & { pinned: boolean })[] = [];
  const a: (Located & { pinned: boolean })[] = [];
  const b: (Located & { pinned: boolean })[] = [];
  const laws: Located[] = [];
  const key = kind.objectKey;
  let reportedPin = false;
  let reportedLaw = false;
  let reportedWorlds = false;

  for (const line of body.data) {
    if (line.key === key || line.key === `pinned ${key}`) {
      const pinned = line.key !== key;

      if (variant === "distinguish") {
        if (!reportedWorlds) {
          diagnostics.push(
            diagnostic(
              line.line,
              "world_distinguish_worlds",
              "A distinguish exercise's objects belong to world A or world B: write “| A {key} : …” or “| B {key} : …”.",
              { params: { key } },
            ),
          );
          reportedWorlds = true;
        }
        continue;
      }

      if (pinned && !edits(variant) && !reportedPin) {
        diagnostics.push(
          diagnostic(
            line.line,
            "world_pinned_variant",
            "Only a build or counterexample exercise has pinned objects.",
          ),
        );
        reportedPin = true;
      }

      world.push({ ...line, pinned: pinned && edits(variant) });
      continue;
    }

    if (line.key === `A ${key}` || line.key === `B ${key}`) {
      if (variant !== "distinguish") {
        if (!reportedWorlds) {
          diagnostics.push(
            diagnostic(
              line.line,
              "world_single_world",
              "Only a distinguish exercise has worlds A and B.",
            ),
          );
          reportedWorlds = true;
        }
        continue;
      }

      (line.key.startsWith("A") ? a : b).push({ ...line, pinned: false });
      continue;
    }

    if (line.key === "law") {
      if (edits(variant)) {
        laws.push(line);
      } else if (!reportedLaw) {
        diagnostics.push(
          diagnostic(
            line.line,
            "world_laws_variant",
            "Only a build or counterexample exercise has laws.",
          ),
        );
        reportedLaw = true;
      }
      continue;
    }

    diagnostics.push(
      diagnostic(
        line.line,
        "unknown_world_line",
        "“{key}” is not a line a world exercise reads. It reads {keys}.",
        {
          params: {
            key: line.key,
            keys:
              variant === "distinguish"
                ? `A ${key}, B ${key}`
                : edits(variant)
                  ? `${key}, pinned ${key}, law`
                  : key,
          },
        },
      ),
    );
  }

  return { a: { lines: a }, b: { lines: b }, laws, world: { lines: world } };
}

export async function compileWorld(
  block: DirectiveBlock,
  context: ExerciseCompileContext,
): Promise<CompiledExercise | null> {
  const { diagnostics, renderOptions, resolveSystem } = context;
  validateAttributes(block, WORLD_ATTRIBUTES, diagnostics);

  const id = requireAttribute(block, "id", diagnostics);
  const points = parsePoints(block.attrs.points, block.line, diagnostics);
  const variant = parseVariant(block.attrs.variant, block.line, diagnostics);
  const title = block.attrs.title?.trim();
  const exam = parseExamAttribute(block.attrs.exam, block.line, diagnostics);
  const feedback = gameFeedback(
    block,
    variant,
    reconcileFeedback(block, undefined, diagnostics),
    diagnostics,
  );
  const budget = parseBudget(block, variant, diagnostics);
  const kindId = block.attrs.world?.trim() || DEFAULT_WORLD_KIND;
  const kind = worldKindById(kindId);

  if (kind === null) {
    diagnostics.push(
      diagnostic(
        block.line,
        "unknown_world_kind",
        "There is no world kind called “{world}”. Known kinds: {known}.",
        {
          params: {
            known: WORLD_KINDS.map((known) => known.id).join(", "),
            world: kindId,
          },
        },
      ),
    );
  }

  // No built-in language has a world's vocabulary, so there is no default to
  // fall back on: an exercise without a system could only report that every
  // symbol means nothing.
  const named = requireAttribute(block, "system", diagnostics);
  const before = diagnostics.length;
  const { language, system } = parseSystemAttribute(
    block,
    resolveSystem,
    diagnostics,
    { defaultId: "forallx-calgary" },
  );
  const resolvedSystem = named !== null && diagnostics.length === before;
  const body = parseBody(block, diagnostics);

  if (id === null || kind === null || !resolvedSystem) {
    return null;
  }

  validateExerciseId(block, id, diagnostics);

  const vocabulary = bindVocabulary(kind, language);
  reportVocabulary(vocabulary, kind, block.line, diagnostics);

  const restriction = parseRestriction(block, variant, language, diagnostics);
  const data = sortData(body, kind, variant, diagnostics);
  const sentenceContext: SentenceContext = {
    diagnostics,
    kind,
    language,
    vocabulary,
  };
  const sentences: WorldSentence[] = [];
  const formulas: { formula: Formula; line: number; text: string }[] = [];

  if (variant === "counterexample") {
    for (const item of body.items) {
      diagnostics.push(
        diagnostic(
          item.line,
          "invalid_world_body",
          "Only sentence list items and | lines may follow the first sentence.",
        ),
      );
    }

    if (body.sequent === null) {
      diagnostics.push(
        diagnostic(
          block.line,
          "missing_world_argument",
          "A counterexample exercise needs one argument with the ':|-:' turnstile, e.g. 'Cube(a) :|-: Large(a)'.",
        ),
      );
    } else {
      const argument = splitArgumentLine(body.sequent.text);

      if (argument === null) {
        diagnostics.push(
          diagnostic(
            body.sequent.line,
            "multiple_turnstiles",
            "A validity sequent must contain exactly one ':|-:' turnstile.",
          ),
        );
      }

      const side = (pieces: readonly string[], target: boolean): void => {
        for (const piece of pieces) {
          const read = readSentence(
            piece,
            body.sequent?.line ?? 0,
            sentenceContext,
          );

          if (read !== null) {
            sentences.push({ engine: read.engine, target });
            formulas.push({ ...read, line: body.sequent?.line ?? 0 });
          }
        }
      };

      side(argument?.premises ?? [], true);
      const before = sentences.length;
      side(argument?.conclusions ?? [], false);

      if (argument !== null && sentences.length === before) {
        diagnostics.push(
          diagnostic(
            body.sequent.line,
            "empty_conclusions",
            "A validity sequent needs at least one conclusion after the ':|-:' turnstile.",
          ),
        );
      }
    }
  } else {
    if (body.sequent !== null) {
      diagnostics.push(
        diagnostic(
          body.sequent.line,
          "world_sequent_variant",
          "Only a counterexample exercise is written as an argument with ':|-:'.",
        ),
      );
    }

    if (variant === "distinguish") {
      for (const item of body.items) {
        diagnostics.push(
          diagnostic(
            item.line,
            "world_distinguish_sentences",
            "A distinguish exercise lists no sentences: the student writes one.",
          ),
        );
      }
    }

    for (const item of variant === "distinguish" ? [] : body.items) {
      if (item.target !== undefined && readsFixedWorld(variant)) {
        diagnostics.push(
          diagnostic(
            item.line,
            "world_evaluate_target",
            "This exercise's sentences take no true: or false: prefix; the world decides their values.",
          ),
        );
      }

      const read = readSentence(item.text, item.line, sentenceContext);

      if (read !== null) {
        sentences.push(
          readsFixedWorld(variant)
            ? { engine: read.engine }
            : { engine: read.engine, target: item.target ?? true },
        );
        formulas.push({ ...read, line: item.line });
      }
    }

    if (variant !== "distinguish" && body.items.length === 0) {
      diagnostics.push(
        diagnostic(
          block.line,
          "empty_world_exercise",
          "A world exercise needs at least one sentence.",
        ),
      );
    }
  }

  const laws: string[] = [];
  const lawFormulas: { formula: Formula; line: number; text: string }[] = [];

  for (const law of data.laws) {
    const read = readSentence(law.text, law.line, sentenceContext);

    if (read !== null) {
      laws.push(read.engine);
      lawFormulas.push({ ...read, line: law.line });
    }
  }

  let start: unknown;
  let pinned: readonly string[] = [];
  let worlds: { a: unknown; b: unknown } | undefined;

  if (variant === "distinguish") {
    const a = readWorld(data.a, kind, language, diagnostics);
    const b = readWorld(data.b, kind, language, diagnostics);
    worlds =
      a === null || b === null ? undefined : { a: a.state, b: b.state };
  } else {
    const world = readWorld(data.world, kind, language, diagnostics);
    start = world?.state;
    pinned = world?.pinned ?? [];

    // A name a sentence uses must name something in a world the student
    // cannot change; in one they edit, naming it is part of the task.
    if (world !== null && readsFixedWorld(variant)) {
      const names = worldNames(kind, world.state);

      for (const { formula, line, text } of formulas) {
        for (const name of formulaNames(formula)) {
          if (!names.has(name)) {
            diagnostics.push(
              diagnostic(
                line,
                "world_name_denotes_nothing",
                "Nothing in the world is named “{name}”, which “{formula}” uses.",
                { params: { formula: text, name } },
              ),
            );
          }
        }
      }
    }
  }

  const publicData: WorldPublicData = {
    ...(budget === undefined ? {} : { budget }),
    laws,
    pinned,
    promptHtml: await renderMarkdownSource(body.promptLines.join("\n"), {
      ...renderOptions,
      lineOffset: block.bodyStartLine - 1,
    }),
    ...(restriction === undefined ? {} : { restriction }),
    sentences,
    ...(start === undefined ? {} : { start }),
    system,
    variant,
    world: kind.id,
    ...(worlds === undefined ? {} : { worlds }),
  };

  // The start world is checked against what it will be graded by, which is
  // the one reading of "a law false at the start" and "already solved" that
  // cannot drift from the grader's.
  if (start !== undefined && edits(variant)) {
    const resolved: ResolvedWorld = {
      kind,
      language,
      laws: lawFormulas.map(({ formula, text }) => ({
        formula,
        target: true,
        text,
      })),
      pinned: new Set(pinned),
      sentences: formulas.map(({ formula, text }, index) => ({
        formula,
        ...(sentences[index]?.target === undefined
          ? {}
          : { target: sentences[index]?.target }),
        text,
      })),
      start,
      vocabulary,
      worlds: null,
    };
    const values = truthValues(resolved, start);

    for (const [index, value] of values.laws.entries()) {
      const law = lawFormulas[index];

      if (value === false && law !== undefined) {
        diagnostics.push(
          diagnostic(
            law.line,
            "world_law_false",
            "The law “{formula}” is false in the starting world.",
            { params: { formula: law.text } },
          ),
        );
      }
    }

    if (
      formulas.length > 0 &&
      judgeWorld(publicData, resolved, { world: start }).ok
    ) {
      diagnostics.push(
        diagnostic(
          block.line,
          "world_already_solved",
          "The starting world already does everything this exercise asks.",
          { severity: "warning" },
        ),
      );
    }
  }

  return buildCompiledExercise({
    answerKind: WORLD_ANSWER_KIND,
    capabilities: WORLD_CAPABILITIES,
    exam,
    feedback,
    id,
    kind: WORLD_KIND,
    nominalPoints: points,
    privateData: {},
    publicData: publicData as unknown as Parameters<
      typeof buildCompiledExercise
    >[0]["publicData"],
    render: WORLD_COMPONENT_METADATA,
    schemaVersion: WORLD_SCHEMA_VERSION,
    title,
  });
}
