import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";

/**
 * The rules for files imported as text — `.css` and `.mm0` — which is how this
 * program keeps stylesheets and MM0 specs in files of their own type instead of
 * inside template literals. `src/text-modules.d.ts` explains the mechanism.
 *
 * Both checks here exist because the failure they catch is *silent*. Get the
 * import form wrong and every build still exits 0; the styles simply are not in
 * the output, and the first report is a reader looking at an unstyled widget.
 */

const ROOT = resolve(import.meta.dir, "..");

const TEXT_EXTENSIONS = [".css", ".mm0"];

async function walk(dir: string): Promise<string[]> {
  const found: string[] = [];

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);

    if (entry.isDirectory()) {
      found.push(...(await walk(path)));
    } else {
      found.push(path);
    }
  }

  return found;
}

describe("text modules", () => {
  test("are imported with the attribute, never re-exported", async () => {
    const sources = (await walk(resolve(ROOT, "src"))).filter((path) =>
      /\.(?:ts|tsx)$/.test(path),
    );

    const offenders: string[] = [];

    for (const path of sources) {
      const source = await Bun.file(path).text();

      // Whole statements, not lines: the formatter wraps a long import across
      // three of them, and a line-wise check then reads the specifier without
      // the attribute that follows and calls every wrapped import broken. Found
      // from the specifier outwards rather than by one regex, so a match cannot
      // run from some earlier `import` to a `.mm0` string much further down.
      for (const hit of source.matchAll(/["'][^"'\n]+\.(?:css|mm0)["']/g)) {
        const opens = source.lastIndexOf("\nimport ", hit.index);
        const reopens = source.lastIndexOf("\nexport ", hit.index);
        const begin = Math.max(opens, reopens);
        const end = source.indexOf(";", hit.index);

        // A `.css` path in ordinary code (a URL, a message) is not an import.
        if (begin < 0 || end < 0 || source.slice(begin, end).includes(";")) {
          continue;
        }

        const statement = source.slice(begin + 1, end + 1);

        // Nor is one in a statement that merely *starts* like an import. A
        // registry keyed by file name — `{ "gentzen-lk.mm0": gentzenLk }` — is
        // an `export const` with no `from` in it, and reading it as a re-export
        // reports the opposite of the truth about a file that imports
        // correctly two lines above. Every form the rules are about names its
        // specifier after `from`, except the side-effect `import "./x.css"`.
        if (
          !/^import\b/.test(statement) &&
          !/^export\b[^;]*\bfrom\b/.test(statement)
        ) {
          continue;
        }

        const where = `${relative(ROOT, path)}: ${statement
          .replace(/\s+/g, " ")
          .trim()}`;

        // `export … from "./x.css" with { type: "text" }` typechecks, and
        // `bun build` then ignores the attribute, runs its own CSS loader, and
        // emits a stylesheet asset nothing loads. Only the import form is
        // honoured by all three bundlers.
        if (statement.startsWith("export")) {
          offenders.push(`${where}  (re-export drops the attribute)`);
          continue;
        }

        if (!/with\s*\{\s*type:\s*"text",?\s*\}/.test(statement)) {
          offenders.push(`${where}  (missing \`with { type: "text" }\`)`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test("leave no stylesheet asset in the client build", async () => {
    const assets = resolve(ROOT, "public/assets");
    const built = await walk(assets).catch(() => null);

    if (built === null) {
      throw new Error(
        "No built client output under public/assets; " +
          "run `bun run build:client` (as `bun run validate` does).",
      );
    }

    // Every stylesheet this program owns is text: the worker serves it from
    // `web/style-assets`, or a widget writes it into its own shadow root. A
    // `.css` file appearing in the bundler's output means an import lost its
    // attribute and the text went with it.
    const stylesheets = built
      .filter((path) => path.endsWith(".css"))
      .map((path) => relative(ROOT, path));

    expect(stylesheets).toEqual([]);
  });

  test("every text file under src is actually imported", async () => {
    const all = await walk(resolve(ROOT, "src"));
    const textFiles = all.filter((path) =>
      TEXT_EXTENSIONS.some((extension) => path.endsWith(extension)),
    );

    // Cheap proof this test is not vacuous.
    expect(textFiles.length).toBeGreaterThan(0);

    const sources = await Promise.all(
      all
        .filter((path) => /\.(?:ts|tsx)$/.test(path))
        .map((path) => Bun.file(path).text()),
    );
    const haystack = sources.join("\n");

    const orphans = textFiles
      .filter((path) => {
        const name = path.slice(path.lastIndexOf("/") + 1);
        return !haystack.includes(`/${name}"`);
      })
      .map((path) => relative(ROOT, path));

    expect(orphans).toEqual([]);
  });
});
