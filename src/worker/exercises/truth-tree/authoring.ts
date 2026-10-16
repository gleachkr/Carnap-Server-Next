import type { SurfaceLanguage, Term } from "@aufbau/syntax";
import { printTerm, walkTerm } from "@aufbau/syntax";
import {
  type CompilerDiagnostic,
  diagnostic,
} from "../../application/content/diagnostics";
import { renderMarkdownSource } from "../../application/content/markdown";
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
import {
  isArgumentLine,
  splitArgumentLine,
} from "../../exercise-kit/formula";
import { parseSystemAttribute } from "../../exercise-kit/systems/attribute";
import type { ExerciseCompileContext } from "../../exercise-kit/type";
import { formulaParseErrors } from "../../logic/specs/diagnostics";
import { sentenceSort } from "../../logic/specs/roles";
import type { TreeDevelopment } from "./aufbau/criteria";
import { readTreeDevelopment } from "./aufbau/criteria";
import type { OkAxioms } from "./aufbau/ok";
import { okAxioms } from "./aufbau/ok";
import {
  isTreeTheory,
  readTreeTheory,
  rootRow,
  type TreeTheory,
  type TreeTheoryProblem,
} from "./aufbau/theory";
import type {
  TruthTreeFinish,
  TruthTreePublicData,
  TruthTreeTask,
} from "./types";
import {
  TREE_ROW_CAP,
  TRUTH_TREE_ANSWER_KIND,
  TRUTH_TREE_CAPABILITIES,
  TRUTH_TREE_COMPONENT_METADATA,
  TRUTH_TREE_KIND,
  TRUTH_TREE_SCHEMA_VERSION,
} from "./types";

const LIST_ITEM = /^\s*-\s+(.+?)\s*$/;

/** What `::::truth-tree{…}` accepts beyond the shared exercise set. */
const TRUTH_TREE_ATTRIBUTES = [
  ...COMMON_EXERCISE_ATTRIBUTES,
  "finish",
  "system",
] as const;

const FINISHES: readonly TruthTreeFinish[] = [
  "closed",
  "complete",
  "one-open",
];

/** When the tree is done: `closed` unless the author says otherwise. */
function parseFinish(
  block: DirectiveBlock,
  diagnostics: CompilerDiagnostic[],
): TruthTreeFinish {
  const value = block.attrs.finish?.trim();

  if (value === undefined) {
    return "closed";
  }

  const finish = FINISHES.find((each) => each === value);

  if (finish === undefined) {
    diagnostics.push(
      diagnostic(
        block.line,
        "truth_tree_finish",
        "The finish attribute must be closed, complete, or one-open.",
      ),
    );
    return "closed";
  }

  return finish;
}

/** The tree theory a tree is set in when the author names none. */
const DEFAULT_TRUTH_TREE_SYSTEM = "forallx-ubc";

interface Located {
  readonly line: number;
  readonly text: string;
}

interface TreeBody {
  readonly promptLines: readonly string[];
  readonly items: readonly Located[];
  readonly arguments: readonly Located[];
}

/**
 * Prose, then the root: one `premises :|-: conclusion` line, or a list of
 * sentences. The prompt is the run of lines before the first of either.
 */
function parseBody(
  block: DirectiveBlock,
  diagnostics: CompilerDiagnostic[],
): TreeBody {
  const promptLines: string[] = [];
  const items: Located[] = [];
  const argumentLines: Located[] = [];
  let pastPrompt = false;

  for (const [index, line] of block.bodyLines.entries()) {
    const lineNumber = block.bodyStartLine + index;

    if (isArgumentLine(line)) {
      pastPrompt = true;
      argumentLines.push({ line: lineNumber, text: line });
      continue;
    }

    const item = LIST_ITEM.exec(line);

    if (item !== null) {
      pastPrompt = true;
      items.push({ line: lineNumber, text: item[1] ?? "" });
      continue;
    }

    if (!pastPrompt) {
      promptLines.push(line);
    } else if (line.trim().length > 0) {
      diagnostics.push(
        diagnostic(
          lineNumber,
          "invalid_truth_tree_body",
          "Only the root's sentences may follow the first of them.",
        ),
      );
    }
  }

  return { arguments: argumentLines, items, promptLines };
}

/** Lines of the body the nested-directive scan leaves alone. */
export function truthTreeDataBodyLines(
  block: DirectiveBlock,
): ReadonlySet<number> {
  const data = new Set<number>();
  let pastPrompt = false;

  for (const [index, line] of block.bodyLines.entries()) {
    pastPrompt ||= LIST_ITEM.test(line) || isArgumentLine(line);

    if (pastPrompt) {
      data.add(block.bodyStartLine + index);
    }
  }

  return data;
}

/**
 * Parse one root sentence, as engine text; `null` after reporting why not.
 *
 * Read as the tree theory's language reads it, not as a formula an evaluator
 * can interpret: a tree's rules are the theory's, so whatever the language
 * parses can be a root (`□A`, which has no truth function).
 */
function readSentence(
  source: string,
  line: number,
  language: SurfaceLanguage,
  diagnostics: CompilerDiagnostic[],
): string | null {
  const trimmed = source.trim();
  const sort = sentenceSort(language);
  const parsed = language.parse(trimmed, sort === undefined ? {} : { sort });

  if (!parsed.ok) {
    diagnostics.push(
      diagnostic(
        line,
        "invalid_formula",
        "Could not parse formula “{formula}”: {detail}",
        {
          params: {
            detail: formulaParseErrors(parsed.diagnostics)[0] ?? {
              message: "syntax error",
            },
            formula: trimmed,
          },
        },
      ),
    );
    return null;
  }

  if (hasFreeVariable(language, parsed.term)) {
    diagnostics.push(
      diagnostic(
        line,
        "truth_tree_open_sentence",
        "“{formula}” has free variables, and a tree's root must be sentences.",
        { params: { formula: trimmed } },
      ),
    );
    return null;
  }

  return printTerm(language, parsed.term, "engine");
}

/**
 * Whether a variable of a sort some term binds (a quantifier's `x`) occurs
 * free. Names are variables to the engine too, but no term binds their sort.
 */
function hasFreeVariable(language: SurfaceLanguage, term: Term): boolean {
  const bindable = new Set<string>();

  for (const info of language.spec.terms.values()) {
    for (const binder of info.binders) {
      if (binder.binds && "sort" in binder.type) {
        bindable.add(binder.type.sort);
      }
    }
  }

  let free = false;

  walkTerm(term, (node, bound) => {
    if (
      node.kind === "variable" &&
      !node.binder &&
      bindable.has(node.sort) &&
      !bound.has(node.name)
    ) {
      free = true;
    }
  });

  return free;
}

/** Each thing a theory lacks to be a tree theory, as an author reads it. */
function reportTreeTheory(
  problems: readonly TreeTheoryProblem[],
  name: string,
  line: number,
  diagnostics: CompilerDiagnostic[],
): void {
  const roles = problems.flatMap((problem) =>
    problem.type === "missing-role" ? [problem.role] : [],
  );

  if (roles.length > 0) {
    diagnostics.push(
      diagnostic(
        line,
        "truth_tree_not_tree_theory",
        "The system “{name}” is not a tree theory: it declares no {roles}.",
        { params: { name, roles: roles.join(", ") } },
      ),
    );
  }

  for (const problem of problems) {
    if (problem.type !== "row-sort") {
      continue;
    }

    diagnostics.push(
      problem.candidates.length === 0
        ? diagnostic(
            line,
            "truth_tree_row_sort",
            "The system “{name}” has no sort that coerces into its branch sort, so its rows have no sort to be written in.",
            { params: { name } },
          )
        : diagnostic(
            line,
            "truth_tree_row_sort",
            "The system “{name}” has several sorts that coerce into its branch sort ({sorts}), and a tree theory needs exactly one: the sort its rows are written in.",
            { params: { name, sorts: problem.candidates.join(", ") } },
          ),
    );
  }
}

/**
 * What the axioms saying when a row is developed (`./aufbau/ok.ts`) could not
 * state: a rule's rows that are then never developed, or a judgement with no
 * congruence, which the engine cannot prove of a branch in any order but its
 * own.
 */
function reportOkAxioms(
  axioms: OkAxioms,
  line: number,
  diagnostics: CompilerDiagnostic[],
): void {
  for (const { problem, rule } of axioms.problems) {
    switch (problem.type) {
      case "unmarked":
        diagnostics.push(
          diagnostic(
            line,
            "truth_tree_development",
            "The rule “{rule}” writes no check mark on a branch it opens, though the system's rules write marks, so Carnap cannot tell from a branch whether a row was developed by it.",
            { params: { rule } },
          ),
        );
        break;
      case "no-view":
        diagnostics.push(
          diagnostic(
            line,
            "truth_tree_development",
            "The rule “{rule}” writes a new name, and has no @view saying where it is in the rows it writes, so Carnap cannot tell from a branch whether a row was developed by it.",
            { params: { rule } },
          ),
        );
        break;
      case "no-relation":
        diagnostics.push(
          diagnostic(
            line,
            "truth_tree_development",
            "The system has no @relation on the sort “{sort}”, which Carnap needs to tell from a branch whether its rows are developed.",
            { params: { sort: problem.sort } },
          ),
        );
        break;
    }
  }
}

/** What is wrong with a theory's development roles, for an open branch. */
function reportDevelopment(
  development: TreeDevelopment,
  axioms: OkAxioms | null,
  name: string,
  line: number,
  diagnostics: CompilerDiagnostic[],
): void {
  if (axioms !== null) {
    reportOkAxioms(axioms, line, diagnostics);
  }

  if (!development.annotated) {
    diagnostics.push(
      diagnostic(
        line,
        "truth_tree_no_development",
        "The system “{name}” says nothing about when a row is developed, so no branch on it can be shown complete: give its rules tree.development roles, or leave finish closed.",
        { params: { name } },
      ),
    );
  }

  for (const { problem, rule } of development.problems) {
    switch (problem.type) {
      case "unknown-kind":
        diagnostics.push(
          diagnostic(
            line,
            "truth_tree_development",
            "The rule “{rule}” names the development kind “{kind}”, which Carnap does not know.",
            {
              params: { rule, kind: problem.kind },
            },
          ),
        );
        break;
      case "several-kinds":
        diagnostics.push(
          diagnostic(
            line,
            "truth_tree_development",
            "The rule “{rule}” names more than one development kind.",
            {
              params: { rule },
            },
          ),
        );
        break;
      case "bad-arguments":
        diagnostics.push(
          diagnostic(
            line,
            "truth_tree_development",
            "The rule “{rule}” gives its development kind the wrong arguments: it is written {expected}.",
            {
              params: {
                expected: `tree.development.${problem.expected}`,
                rule,
              },
            },
          ),
        );
        break;
      case "unknown-binder":
        diagnostics.push(
          diagnostic(
            line,
            "truth_tree_development",
            "The rule “{rule}” names “{binder}” as its instance, but has no binder of that name.",
            {
              params: { rule, binder: problem.binder },
            },
          ),
        );
        break;
      case "single-row-focus":
        diagnostics.push(
          diagnostic(
            line,
            "truth_tree_development",
            "The rule “{rule}” develops more than one row, and its development kind is for a rule on one row.",
            {
              params: { rule },
            },
          ),
        );
        break;
      case "pair-focus":
        diagnostics.push(
          diagnostic(
            line,
            "truth_tree_development",
            "The rule “{rule}” does not develop two rows, and its development kind is for a rule on a pair of rows.",
            {
              params: { rule },
            },
          ),
        );
        break;
      case "no-template":
        diagnostics.push(
          diagnostic(
            line,
            "truth_tree_development",
            "The rule “{rule}” names “{binder}” as its instance, but no one row it writes mentions it.",
            {
              params: { rule, binder: problem.binder },
            },
          ),
        );
        break;
      case "unknown-flag":
        diagnostics.push(
          diagnostic(
            line,
            "truth_tree_development",
            "The rule “{rule}” has the development flag “{flag}”, which its kind does not take.",
            {
              params: { rule, flag: problem.flag },
            },
          ),
        );
        break;
      case "no-relation":
        diagnostics.push(
          diagnostic(
            line,
            "truth_tree_development",
            "The rule “{rule}” counts instances, which needs an @relation on its judgement sort that names a modus ponens rule.",
            {
              params: { rule },
            },
          ),
        );
        break;
      case "unreadable":
        diagnostics.push(
          diagnostic(
            line,
            "truth_tree_development",
            "The rule “{rule}” concludes a focused branch, but Carnap cannot read its premises as rows written on the branch, so no row is ever owed a step by it.",
            {
              params: { rule },
            },
          ),
        );
        break;
      case "unknown-role":
        diagnostics.push(
          diagnostic(
            line,
            "truth_tree_development",
            "The system gives “{rule}” the role “{role}”, which Carnap does not know.",
            {
              params: { rule, role: problem.role },
            },
          ),
        );
        break;
      case "bad-substitution":
        diagnostics.push(
          diagnostic(
            line,
            "truth_tree_development",
            "The term “{rule}” has the role tree.substitution, but is not a substitution: it needs three arguments, a bound variable, a body of its own sort, and the term put for the variable.",
            {
              params: { rule },
            },
          ),
        );
        break;
    }
  }
}

export async function compileTruthTree(
  block: DirectiveBlock,
  context: ExerciseCompileContext,
): Promise<CompiledExercise | null> {
  const { diagnostics, renderOptions, resolveSystem } = context;
  validateAttributes(block, TRUTH_TREE_ATTRIBUTES, diagnostics);

  const id = requireAttribute(block, "id", diagnostics);
  const points = parsePoints(block.attrs.points, block.line, diagnostics);
  const title = block.attrs.title?.trim();
  const exam = parseExamAttribute(block.attrs.exam, block.line, diagnostics);
  const feedback = reconcileFeedback(block, undefined, diagnostics);
  const { language, system } = parseSystemAttribute(
    block,
    resolveSystem,
    diagnostics,
    { defaultId: DEFAULT_TRUTH_TREE_SYSTEM },
  );
  const finish = parseFinish(block, diagnostics);
  const body = parseBody(block, diagnostics);

  if (id === null) {
    return null;
  }

  validateExerciseId(block, id, diagnostics);

  const read = readTreeTheory(language);

  if (!isTreeTheory(read)) {
    reportTreeTheory(read, system, block.line, diagnostics);
    return null;
  }

  const theory: TreeTheory = read;

  // A branch can be marked open only where the theory says when it is done.
  if (finish !== "closed") {
    const development = readTreeDevelopment(language, theory);

    reportDevelopment(
      development,
      development.annotated ? okAxioms(language, theory, development) : null,
      system,
      block.line,
      diagnostics,
    );
  }
  let task: TruthTreeTask = "consistency";
  const premises: string[] = [];
  const conclusions: string[] = [];

  if (body.arguments.length > 0 && body.items.length > 0) {
    diagnostics.push(
      diagnostic(
        block.line,
        "truth_tree_mixed_root",
        "Write the root as one argument line or as a list of sentences, not both.",
      ),
    );
  } else if (body.arguments.length > 0) {
    task = "validity";

    for (const extra of body.arguments.slice(1)) {
      diagnostics.push(
        diagnostic(
          extra.line,
          "multiple_turnstiles",
          "A validity sequent must contain exactly one ':|-:' turnstile.",
        ),
      );
    }

    const first = body.arguments[0] as Located;
    const argument = splitArgumentLine(first.text);

    if (argument === null) {
      diagnostics.push(
        diagnostic(
          first.line,
          "multiple_turnstiles",
          "A validity sequent must contain exactly one ':|-:' turnstile.",
        ),
      );
    } else if (argument.conclusions.length === 0) {
      diagnostics.push(
        diagnostic(
          first.line,
          "empty_conclusions",
          "A validity sequent needs at least one conclusion after the ':|-:' turnstile.",
        ),
      );
    } else if (argument.conclusions.length > 1) {
      diagnostics.push(
        diagnostic(
          first.line,
          "truth_tree_conclusions",
          "A truth tree tests an argument with one conclusion.",
        ),
      );
    } else {
      for (const piece of argument.premises) {
        const formula = readSentence(
          piece,
          first.line,
          language,
          diagnostics,
        );

        if (formula !== null) {
          premises.push(formula);
        }
      }

      for (const piece of argument.conclusions) {
        const formula = readSentence(
          piece,
          first.line,
          language,
          diagnostics,
        );

        if (formula !== null) {
          conclusions.push(formula);
        }
      }
    }
  } else if (body.items.length > 0) {
    for (const item of body.items) {
      const formula = readSentence(
        item.text,
        item.line,
        language,
        diagnostics,
      );

      if (formula !== null) {
        premises.push(formula);
      }
    }
  } else {
    diagnostics.push(
      diagnostic(
        block.line,
        "truth_tree_no_root",
        "A truth tree needs a root: an argument line “premises :|-: conclusion”, or a list of sentences.",
      ),
    );
  }

  if (task === "validity" && theory.deny === null) {
    diagnostics.push(
      diagnostic(
        block.line,
        "truth_tree_no_denial",
        "The system “{name}” cannot deny a sentence, which testing an argument needs: give it a tree.deny term, or a negation if its rows are sentences.",
        { params: { name: system } },
      ),
    );
    return null;
  }

  // The root asserts the premises and denies the conclusion (UBC §5.2: the
  // premises and the conclusion's negation), in the theory's own rows. These
  // are the only rows a reader sees that the author did not type.
  const root: string[] = [];

  for (const [sentence, polarity] of [
    ...premises.map((sentence) => [sentence, "assert"] as const),
    ...conclusions.map((sentence) => [sentence, "deny"] as const),
  ]) {
    const row = rootRow(language, theory, sentence, polarity);

    if (row === null) {
      diagnostics.push(
        diagnostic(
          block.line,
          "truth_tree_unprintable_root",
          "The root could not be written in the language.",
        ),
      );
      return null;
    }

    root.push(row);
  }

  if (root.length > TREE_ROW_CAP) {
    diagnostics.push(
      diagnostic(
        block.line,
        "truth_tree_root_too_long",
        "A truth tree's root may have at most {max} sentences.",
        { params: { max: String(TREE_ROW_CAP) } },
      ),
    );
  }

  const publicData: TruthTreePublicData = {
    // Stored only where it is not the default.
    ...(finish === "closed" ? {} : { finish }),
    premises: premises.length,
    promptHtml: await renderMarkdownSource(body.promptLines.join("\n"), {
      ...renderOptions,
      lineOffset: block.bodyStartLine - 1,
    }),
    root,
    system,
    task,
  };

  return buildCompiledExercise({
    answerKind: TRUTH_TREE_ANSWER_KIND,
    capabilities: TRUTH_TREE_CAPABILITIES,
    exam,
    feedback,
    id,
    kind: TRUTH_TREE_KIND,
    nominalPoints: points,
    privateData: {},
    publicData: publicData as unknown as Parameters<
      typeof buildCompiledExercise
    >[0]["publicData"],
    render: TRUTH_TREE_COMPONENT_METADATA,
    schemaVersion: TRUTH_TREE_SCHEMA_VERSION,
    title,
  });
}
