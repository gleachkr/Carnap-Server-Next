import { describe, expect, test } from "bun:test";
import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import type { ExerciseManifestItem } from "../src/worker/domain/content";
import { withSystemText } from "../src/worker/exercise-kit/systems/join";
import type { ResolvedTree } from "../src/worker/exercises/truth-tree/grading";
import { resolveTruthTree } from "../src/worker/exercises/truth-tree/grading";
import type { TruthTreePublicData } from "../src/worker/exercises/truth-tree/types";
import { engine } from "./helpers/truth-tree";
import type {
  Difference,
  GenerateOptions,
} from "./helpers/truth-tree-differential";
import {
  describe as describeDifference,
  differences,
  FAULT_KINDS,
  generate,
  judgeAsBrowser,
  project,
  unexplained,
} from "./helpers/truth-tree-differential";
import { UBC_TREE_ROOTS } from "./helpers/ubc-tree-roots";

/**
 * The generic truth-tree checker against the UBC one (gh #46, #440), over
 * every root the book works a tree from, and a few it does not: each tree
 * developed correctly, ended and unended, a general row's instances one per
 * step and several, and with one fault of each kind.
 *
 * By default each kind of fault goes at one place in each tree, the kinds
 * taking its first step, its middle one and its last in turn.
 * `TREE_DIFF_FULL=1` puts every fault at every step, which takes about half
 * an hour; `TREE_DIFF_PROBE=1` prints each difference.
 */

const FULL = process.env.TREE_DIFF_FULL !== undefined;
const PROBE = process.env.TREE_DIFF_PROBE !== undefined;

/** Roots the book has no tree for, for what its trees never meet. */
const EDGE_ROOTS: readonly { from: string; root: readonly string[] }[] = [
  // Nothing to develop: the tree is its root, and states no inference.
  { from: "edge: literals only", root: ["Fa", "¬Gb"] },
  { from: "edge: a closed root", root: ["P", "¬P"] },
];

const exercises = new Map<
  string,
  Promise<{ resolved: ResolvedTree; mm0: string }>
>();

/** The consistency exercise on a root, compiled once per root. */
function exercise(
  root: readonly string[],
): Promise<{ resolved: ResolvedTree; mm0: string }> {
  const key = JSON.stringify(root);
  let found = exercises.get(key);

  if (found === undefined) {
    found = compileExercise(root);
    exercises.set(key, found);
  }

  return found;
}

async function compileExercise(
  root: readonly string[],
): Promise<{ resolved: ResolvedTree; mm0: string }> {
  const result = await compileCarnapMarkdown(
    `::::truth-tree{#t finish="one-open"}\nIs this set consistent?\n\n${root.map((each) => `- ${each}`).join("\n")}\n::::`,
  );

  if (!result.ok) {
    throw new Error(result.diagnostics.map((d) => d.code).join(", "));
  }

  const raw = result.artifact.manifest[0] as ExerciseManifestItem;
  const publicData = withSystemText(
    raw.publicData,
    result.artifact.systems,
  ) as unknown as TruthTreePublicData;
  const resolved = resolveTruthTree(publicData);

  if (resolved === null || publicData.mm0 === undefined) {
    throw new Error("the exercise does not resolve");
  }

  return { mm0: publicData.mm0, resolved };
}

interface Outcome {
  readonly name: string;
  readonly differences: readonly Difference[];
}

/**
 * Both checkers' word on one generated tree, or null where the fault had
 * nowhere to go or made a tree already compared.
 */
async function compare(
  root: readonly string[],
  name: string,
  options: GenerateOptions,
  seen: Set<string>,
): Promise<Outcome | null> {
  const { builder, faulted } = generate(root, options);
  const key = JSON.stringify(builder.answer());

  // A fault goes at the first step it fits at or after its position, so
  // several positions can make the same tree.
  if (!faulted || seen.has(key)) {
    return null;
  }

  seen.add(key);

  const { mm0, resolved } = await exercise(builder.rootTexts);
  const rules = builder.answer().rules;
  const old = project(builder.tree, builder.check(), rules);
  const generic = project(
    builder.tree,
    judgeAsBrowser(await engine(), resolved, mm0, builder.answer()),
    rules,
  );

  return { differences: differences(old, generic), name };
}

/** Every tree a root is compared on. */
async function outcomes(root: readonly string[]): Promise<Outcome[]> {
  const found: Outcome[] = [];
  const seen = new Set<string>();
  const add = (outcome: Outcome | null) => {
    if (outcome !== null) {
      found.push(outcome);
    }
  };

  for (const multi of [false, true]) {
    for (const unended of [false, true]) {
      add(
        await compare(
          root,
          `correct${multi ? ", instances together" : ""}${unended ? ", unended" : ""}`,
          { multi, unended },
          seen,
        ),
      );
    }
  }

  const steps = generate(root).steps;
  const every = Array.from({ length: steps + 1 }, (_, at) => at);
  const ends = [0, Math.floor(steps / 2), steps];

  for (const [index, kind] of FAULT_KINDS.entries()) {
    for (const at of FULL ? every : [ends[index % ends.length] as number]) {
      add(
        await compare(
          root,
          `${kind} at step ${at}`,
          { fault: { at, kind } },
          seen,
        ),
      );
    }
  }

  return found;
}

describe("the generic checker agrees with the UBC checker", () => {
  for (const { from, root } of [...UBC_TREE_ROOTS, ...EDGE_ROOTS]) {
    test(
      `${from}: ${root.join(", ")}`,
      async () => {
        const disagreeing = (await outcomes(root)).flatMap((outcome) => {
          const left = unexplained(outcome.differences);
          return left.length === 0
            ? []
            : [`${outcome.name}: ${left.map(describeDifference).join("; ")}`];
        });

        if (PROBE) {
          for (const each of disagreeing) {
            console.log(`${root.join(", ")} | ${each}`);
          }
        }

        expect(disagreeing).toEqual([]);
      },
      FULL ? 1_800_000 : 60_000,
    );
  }
});

describe("identity completion (UBC §12.7)", () => {
  // An open branch owes each identity substituted into every literal on it:
  // the generic checker asks for it as the UBC one does (`pairs`).
  test("an identity left unsubstituted on an open branch", async () => {
    const outcome = await compare(
      ["Fa", "¬ Fb", "a=b"],
      "skip-identity",
      { fault: { at: 0, kind: "skip-identity" } },
      new Set(),
    );

    expect(outcome?.differences.map(describeDifference)).toEqual([]);
  });
});
