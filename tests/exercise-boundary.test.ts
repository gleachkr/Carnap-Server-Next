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
 * are on the far side of a different boundary.
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
   * The root of `exercises/` holds only the glue that enumerates the types
   * (`strings.ts`, `group.ts` today), and that glue may see a type only through
   * its declared surface: the kind constants and metadata in `types.ts`, and
   * the widget text in `strings.ts`. Reaching further — into a type's
   * authoring, assessment or rendering — would make the glue a second home for
   * that type's logic.
   *
   * This rule tightens once every type exports one object from its `index.ts`
   * (#309): from then on the root reaches each type through that index alone.
   */
  test("the root glue sees a type only through its declared surface", async () => {
    const edges = await edgesUnder(EXERCISES);
    const glue = edges.filter((edge) => isRootGlue(edge.from));
    const reaching = glue.filter((edge) => {
      if (typeFolder(edge.target) === null) {
        return false;
      }

      const file = posix.basename(edge.target);

      return file !== "types" && file !== "strings";
    });

    expect(glue.length).toBeGreaterThan(10);
    expect(
      describeEdges(reaching),
      "a root glue file is reading past a type's types.ts/strings.ts — keep the glue to enumerating what each type declares",
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
