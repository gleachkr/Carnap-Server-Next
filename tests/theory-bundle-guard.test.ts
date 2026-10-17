import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { NAMED_LANGUAGE_SOURCES } from "../src/worker/logic/specs/by-id";
import { THEORY_SOURCES } from "../src/worker/logic/theories";

/**
 * The exercise widgets carry only the theories they name by id.
 *
 * A widget reads its language from the text its hydration carries, so the
 * only theory text it needs in its bundle is what `logic/specs/by-id.ts`
 * imports: the languages exercise data names by id. Reaching the registry of
 * every shipped language (`logic/specs/index.ts`) or the theory directory
 * (`logic/theories/index.ts`) instead puts every theory in the shared chunk
 * that model, translation, truth-table, world and truth-tree all load: 200 KB
 * of Open Logic and UBC text, once. The author's preview, which compiles
 * lessons in the browser, carries them by design and is not a component.
 *
 * Scans the built bundles, as `i18n-bundle-guard.test.ts` does, so an unbuilt
 * tree fails rather than passing unchecked.
 */

const ROOT = resolve(import.meta.dir, "..");
const COMPONENTS = resolve(ROOT, "public/assets/components");

/**
 * A line of a theory a minifier keeps as written (plain ASCII, long enough
 * not to occur by chance, with nothing a string literal would escape) that
 * no named language has: `forallx-calgary-plus` opens with Calgary's text.
 */
function markerOf(
  source: string,
  named: readonly string[],
): string | undefined {
  return source
    .split("\n")
    .find(
      (line) =>
        line.length >= 40 &&
        /^[\w .,:;()=-]+$/u.test(line) &&
        !named.some((each) => each.includes(line)),
    );
}

describe("theory text in the component bundles", () => {
  test("only the theories a widget names by id are bundled", async () => {
    const files = (await readdir(COMPONENTS)).filter((name) =>
      name.endsWith(".js"),
    );

    expect(files.length).toBeGreaterThan(0);

    const bundles = await Promise.all(
      files.map(async (name) => ({
        name,
        text: await Bun.file(resolve(COMPONENTS, name)).text(),
      })),
    );
    const named = Object.values(NAMED_LANGUAGE_SOURCES);
    const found: string[] = [];
    let checked = 0;

    for (const [file, source] of Object.entries(THEORY_SOURCES)) {
      const marker = markerOf(source, named);

      if (marker === undefined) {
        continue;
      }

      checked += 1;

      for (const bundle of bundles) {
        if (bundle.text.includes(marker)) {
          found.push(`${file} in ${bundle.name}`);
        }
      }
    }

    // Cheap proof this test is not vacuous.
    expect(checked).toBeGreaterThan(5);
    expect(found).toEqual([]);
  });

  test("the named languages are the shipped files, byte for byte", () => {
    for (const [id, source] of Object.entries(NAMED_LANGUAGE_SOURCES)) {
      expect({ id, source }).toEqual({
        id,
        source: THEORY_SOURCES[`${id}.mm0`] ?? "",
      });
    }
  });
});
