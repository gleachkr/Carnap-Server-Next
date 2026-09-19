import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createApp } from "../src/worker/app";
import {
  BUILT_IN_THEORY_PATHS,
  THEORY_ROUTE_PREFIX,
  THEORY_SOURCES,
  theoryByPath,
} from "../src/worker/logic/theories";

/**
 * The built-in theories are addressed by URL, and the compiler answers those
 * URLs from the module graph rather than by fetching them. That short-circuit is
 * only honest if the route serves the same bytes, so the case that matters most
 * here is the one comparing the two.
 *
 * The rest guards the registry the way `language-specs.test.ts` guards the
 * specs: a file in the directory that nothing registers is invisible, and a
 * registration naming no file is a 404 an author would meet instead of a
 * theory.
 */

const THEORIES_DIR = resolve(import.meta.dir, "../src/worker/logic/theories");

describe("built-in theories", () => {
  test("every `.mm0` in the directory is registered under its own name", async () => {
    const files = (await readdir(THEORIES_DIR))
      .filter((name) => name.endsWith(".mm0"))
      .sort();

    // Cheap proof this test is not vacuous.
    expect(files.length).toBeGreaterThan(0);
    expect(files).toEqual(
      Object.keys(THEORY_SOURCES)
        .filter((name) => !name.endsWith("-plus.mm0"))
        .sort(),
    );
  });

  test("every `-plus` registration is a file and its `derived/` fragment, and nothing else", async () => {
    const fragments = (await readdir(resolve(THEORIES_DIR, "derived")))
      .filter((name) => name.endsWith(".mm0"))
      .sort();
    const plus = Object.keys(THEORY_SOURCES)
      .filter((name) => name.endsWith("-plus.mm0"))
      .sort();

    // One fragment per `-plus` system: a fragment nothing composes is
    // invisible, a `-plus` with no fragment is the base under a second name.
    expect(plus.map((name) => name.replace(/-plus\.mm0$/, ".mm0"))).toEqual(
      fragments,
    );

    for (const fragment of fragments) {
      const base = await readFile(resolve(THEORIES_DIR, fragment), "utf8");
      const derived = await readFile(
        resolve(THEORIES_DIR, "derived", fragment),
        "utf8",
      );

      expect(
        THEORY_SOURCES[fragment.replace(/\.mm0$/, "-plus.mm0")],
        fragment,
      ).toBe(`${base}\n${derived}`);
    }
  });

  test("the listed paths are the registered files, under the prefix", () => {
    expect(BUILT_IN_THEORY_PATHS).toEqual(
      Object.keys(THEORY_SOURCES)
        .map((name) => `${THEORY_ROUTE_PREFIX}${name}`)
        .sort(),
    );
  });

  test("a path names its theory; anything else is a miss", () => {
    const forallx = theoryByPath("/theories/forallx-calgary-2019.mm0");

    expect(forallx).toBe(THEORY_SOURCES["forallx-calgary-2019.mm0"] ?? "");
    // The stem alone, a bare name, and a path elsewhere are all the same miss.
    expect(theoryByPath("/theories/forallx-calgary-2019")).toBeNull();
    expect(theoryByPath("forallx-calgary-2019.mm0")).toBeNull();
    expect(theoryByPath("/content/revisions/abc/source")).toBeNull();
  });

  test("what the route serves is what the compiler resolves", async () => {
    const app = createApp();

    // Every one of them, so a theory added later cannot skip this.
    for (const path of BUILT_IN_THEORY_PATHS) {
      const response = await app.request(path);

      expect({ path, status: response.status }).toEqual({
        path,
        status: 200,
      });
      expect(response.headers.get("Content-Type")).toBe(
        "text/plain; charset=utf-8",
      );
      expect(await response.text()).toBe(theoryByPath(path) ?? "");
    }
  });

  test("an unknown theory file is a 404, not an empty theory", async () => {
    const response = await createApp().request(
      "/theories/no-such-theory.mm0",
    );

    expect(response.status).toBe(404);
  });

  test("a served theory carries an ETag so revalidation is cheap", async () => {
    const response = await createApp().request(
      BUILT_IN_THEORY_PATHS[0] ?? "",
    );

    expect(response.headers.get("ETag")).toMatch(/^"[a-z0-9]+"$/);
  });
});
