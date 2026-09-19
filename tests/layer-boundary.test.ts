import { describe, expect, test } from "bun:test";
import { dirname, posix } from "node:path";

/**
 * The import boundary between the request-shaped outside and the services.
 *
 * `src/worker/domain/` and `src/worker/application/` take what they need as
 * parameters — an actor, a key resolver, a score sender, a translator — and
 * never reach for a request or a network of their own. That is what lets a
 * service be driven from a test, a seed script, or a queue consumer with no
 * `Context` in hand; and it was true by convention only, until an
 * `authFailure` read on a Hono context and a JWKS fetch had both settled into
 * `application/`. Same ratchet idiom as `tests/exercise-boundary.test.ts`:
 * the list of offending edges is empty and stays empty, printed as
 * `file → specifier` when it is not.
 */

const INSIDE = ["src/worker/domain", "src/worker/application"];
/** Packages the inside never sees: the HTTP framework. */
const OUTSIDE_PACKAGES = ["hono"];
/** Folders the inside never imports from: everything that is a request or a wire. */
const OUTSIDE_FOLDERS = [
  "src/worker/infrastructure",
  "src/worker/routes",
  "src/worker/web",
  "src/worker/http",
];

const SPECIFIER =
  /\b(?:import|export)\s+(?:type\s+)?(?:\{[^}]*\}|\*(?:\s+as\s+\w+)?|\w+(?:\s*,\s*\{[^}]*\})?)\s*from\s*["']([^"']+)["']|\bimport\s*\(?\s*["']([^"']+)["']/g;

async function outwardEdges(): Promise<string[]> {
  const edges: string[] = [];

  for (const root of INSIDE) {
    for await (const path of new Bun.Glob(`${root}/**/*.{ts,tsx}`).scan(
      ".",
    )) {
      const source = await Bun.file(path).text();

      for (const match of source.matchAll(SPECIFIER)) {
        const specifier = match[1] ?? match[2] ?? "";
        const target = specifier.startsWith(".")
          ? posix.normalize(posix.join(dirname(path), specifier))
          : null;
        const outward =
          target === null
            ? OUTSIDE_PACKAGES.some(
                (name) =>
                  specifier === name || specifier.startsWith(`${name}/`),
              )
            : OUTSIDE_FOLDERS.some(
                (folder) =>
                  target === folder || target.startsWith(`${folder}/`),
              );

        if (outward) {
          edges.push(`${path} → ${specifier}`);
        }
      }
    }
  }

  return edges.sort();
}

describe("the application layer's import boundary", () => {
  test("domain and application import no request, wire, or framework", async () => {
    expect(await outwardEdges()).toEqual([]);
  });
});
