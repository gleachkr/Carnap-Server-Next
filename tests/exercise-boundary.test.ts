import { describe, expect, test } from "bun:test";
import { dirname, posix } from "node:path";

/**
 * The import boundary between the exercise types and what they are built from.
 *
 * `src/worker/exercises/<type>/` is one exercise type per folder and
 * `src/worker/exercise-kit/` is what the types share, under one rule: a type
 * imports the kit, and the kit never imports a type. Nothing in the module
 * system enforces that, and the folder layout alone did not keep it — the four
 * proof types spent a year reaching into `aufbau-proof/` for their shared
 * helpers, and the Prawitz type read the tree type's parser, until the kit was
 * carved out. This test is what keeps the carving.
 *
 * Every rule prints the edges that break it, as `file → specifier`, so a
 * failure names the import to move rather than the rule it broke. Same ratchet
 * idiom as `tests/a11y` and the CSS fallback test: the list is empty and stays
 * empty.
 *
 * Only relative imports are read. A bare specifier is a package, and packages
 * are on the far side of a different boundary. And only `src/` is walked: the
 * verify scripts under `scripts/` reach into the proof types by name on
 * purpose — they are the types' own engine batteries, run by hand — and the
 * tests are the tests.
 */

const EXERCISES = "src/worker/exercises";
const KIT = "src/worker/exercise-kit";

/** The import edges of one module, as written. */
interface Edge {
  readonly from: string;
  readonly specifier: string;
  /** The specifier resolved against the importing file, extension-free. */
  readonly target: string;
}

/**
 * Every ESM form that names a module: `import x from`, `import { a, b } from`
 * (over as many lines as it likes), `import x, { a } from`, `import * as ns
 * from`, the `type` variants of each, the `export … from` re-exports, a bare
 * side-effect `import "./x.css"`, and a dynamic `import("…")`.
 */
const SPECIFIER =
  /\b(?:import|export)\s+(?:type\s+)?(?:\{[^}]*\}|\*(?:\s+as\s+\w+)?|\w+(?:\s*,\s*\{[^}]*\})?)\s*from\s*["']([^"']+)["']|\bimport\s*\(?\s*["']([^"']+)["']/g;

async function edgesOf(path: string): Promise<Edge[]> {
  const source = await Bun.file(path).text();
  const edges: Edge[] = [];

  for (const match of source.matchAll(SPECIFIER)) {
    const specifier = match[1] ?? match[2] ?? "";

    if (!specifier.startsWith(".")) {
      continue;
    }

    edges.push({
      from: path,
      specifier,
      target: posix.normalize(posix.join(dirname(path), specifier)),
    });
  }

  return edges;
}

async function edgesUnder(root: string): Promise<Edge[]> {
  const glob = new Bun.Glob(`${root}/**/*.{ts,tsx}`);
  const edges: Edge[] = [];

  for await (const path of glob.scan(".")) {
    if (path.endsWith(".d.ts")) {
      continue;
    }

    edges.push(...(await edgesOf(path)));
  }

  return edges.sort((left, right) =>
    `${left.from} ${left.specifier}`.localeCompare(
      `${right.from} ${right.specifier}`,
    ),
  );
}

/**
 * The type folder a path is in, or `null` for the root glue files and for
 * anything outside `exercises/`.
 */
function typeFolder(path: string): string | null {
  const rest = path.startsWith(`${EXERCISES}/`)
    ? path.slice(EXERCISES.length + 1)
    : null;

  if (rest === null) {
    return null;
  }

  const slash = rest.indexOf("/");

  return slash === -1 ? null : rest.slice(0, slash);
}

function isRootGlue(path: string): boolean {
  return path.startsWith(`${EXERCISES}/`) && typeFolder(path) === null;
}

function describeEdges(edges: readonly Edge[]): string[] {
  return edges.map((edge) => `${edge.from} → ${edge.specifier}`);
}

describe("the exercise import boundary", () => {
  test("no exercise type imports another", async () => {
    const edges = await edgesUnder(EXERCISES);
    const crossing = edges.filter((edge) => {
      const from = typeFolder(edge.from);
      const to = typeFolder(edge.target);

      return from !== null && to !== null && from !== to;
    });

    // Not a vacuous pass: the ten folders import from each other's siblings
    // constantly *within* a folder, so an empty scan would show up here.
    expect(edges.length).toBeGreaterThan(50);
    expect(
      describeEdges(crossing),
      "a type is reading another type's module — whatever it needs belongs in src/worker/exercise-kit/, where both can reach it",
    ).toEqual([]);
  });

  test("the kit imports no exercise type", async () => {
    const edges = await edgesUnder(KIT);
    const crossing = edges.filter((edge) =>
      edge.target.startsWith(`${EXERCISES}/`),
    );

    expect(edges.length).toBeGreaterThan(20);
    expect(
      describeEdges(crossing),
      "the kit is reaching into src/worker/exercises/ — the kit is what a type is built from, and cannot depend on the thing it builds",
    ).toEqual([]);
  });

  /**
   * The root of `exercises/` is one file, `index.ts`, and it reaches each type
   * through that type's own `index.ts` alone — the one `ExerciseType` object a
   * folder exports. Reaching further, into a type's authoring, assessment or
   * rendering, would make the root a second home for that type's logic; it
   * happened to `strings.ts` and `group.ts`, which enumerated every type by
   * hand until #309 folded them into the object.
   */
  test("the root sees a type only through its index", async () => {
    const edges = await edgesUnder(EXERCISES);
    const glue = edges.filter((edge) => isRootGlue(edge.from));
    const reaching = glue.filter(
      (edge) =>
        typeFolder(edge.target) !== null &&
        edge.target !== `${EXERCISES}/${typeFolder(edge.target)}`,
    );

    expect(glue.length).toBe(11);
    expect(
      describeEdges(reaching),
      "the root is reading past a type's index.ts — whatever it wants belongs on that type's ExerciseType object",
    ).toEqual([]);
  });

  /**
   * The same rule for the rest of the worker: the compiler, the services, the
   * routes and the page renderers reach a type through the registry, which
   * reaches it through `exercises/index.ts`. Before this the compiler kept its
   * own list of which directives take a raw body and imported the model type's
   * body splitter by name, and the attempt page imported the two text types'
   * shapes to build their forms itself — so a new raw-body type silently got
   * raw-HTML diagnostics for its `<`, and a type whose form differed from its
   * preview had a second renderer nobody would think to look for. Whatever the
   * outer layers need to know about a type belongs on its `ExerciseType`.
   */
  test("the rest of the worker sees a type only through the registry", async () => {
    const edges = (await edgesUnder("src/worker")).filter(
      (edge) =>
        !edge.from.startsWith(`${EXERCISES}/`) &&
        !edge.from.startsWith(`${KIT}/`),
    );
    const reaching = edges.filter((edge) => typeFolder(edge.target) !== null);

    expect(edges.length).toBeGreaterThan(100);
    expect(
      describeEdges(reaching),
      "a module outside src/worker/exercises/ is reading a type's folder — whatever it needs belongs on that type's ExerciseType object, asked of the registry",
    ).toEqual([]);
  });

  /**
   * The verifier binds a wasm module the worker instantiates and no browser
   * bundle should carry; `package.json` maps `#proof-verifier` to it under
   * `workerd` and to a stub under `browser`. A relative import would step
   * around that map and put the wasm back in the preview bundle as an asset.
   */
  test("the verifier is reached only through #proof-verifier", async () => {
    const edges = await edgesUnder("src");
    const direct = edges.filter((edge) =>
      edge.target.endsWith(`${KIT}/proof/verifier`),
    );

    expect(
      describeEdges(direct),
      'import { verifyMmb } from "#proof-verifier" instead — the bare specifier is what lets the browser build swap in the stub',
    ).toEqual([]);
  });

  /**
   * Not a rule, a report: the client bundles under `src/client/` import from
   * the worker's exercise folders (a widget reads its own type's shapes,
   * strings and grading helpers), and that is expected. Set
   * `EXERCISE_BOUNDARY_REPORT=1` to print the table when deciding what should
   * move into the kit next.
   */
  test("the client's imports of the worker's exercise code are reported", async () => {
    const edges = await edgesUnder("src/client");
    const intoExercises = edges.filter(
      (edge) =>
        edge.target.startsWith(`${EXERCISES}/`) ||
        edge.target.startsWith(`${KIT}/`),
    );

    if (process.env.EXERCISE_BOUNDARY_REPORT !== undefined) {
      console.log(describeEdges(intoExercises).join("\n"));
    }

    // Every widget reads at least its own type's shapes.
    expect(intoExercises.length).toBeGreaterThan(0);
  });
});
