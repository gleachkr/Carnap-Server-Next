import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
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
    expect(files).toEqual(Object.keys(THEORY_SOURCES).sort());
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
      "/theories/forallx-magnus.mm0",
    );

    expect(response.status).toBe(404);
  });

  test("a served theory carries an ETag so revalidation is cheap", async () => {
    const response = await createApp().request(
      BUILT_IN_THEORY_PATHS[0] ?? "",
    );

    expect(response.headers.get("ETag")).toMatch(/^"[a-z0-9]+"$/);
  });

  test("the shipped theories are the ones the proof suites run against", async () => {
    const { FORALLX_THEORY_MM0 } = await import("./helpers/forallx-theory");
    const { GENTZEN_THEORY_MM0 } = await import("./helpers/gentzen-theory");

    expect(FORALLX_THEORY_MM0).toBe(
      THEORY_SOURCES["forallx-calgary-2019.mm0"] ?? "",
    );
    expect(GENTZEN_THEORY_MM0).toBe(THEORY_SOURCES["gentzen-lk.mm0"] ?? "");
  });
});
