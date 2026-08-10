import { describe, expect, test } from "bun:test";
import {
  CONTENT_SCRIPT_ASSET,
  EXERCISE_SCRIPT_ASSET,
  lookupScript,
  REVIEW_SCRIPT_ASSET,
  SCRIPT_CACHE_CONTROL,
  SCRIPT_ROUTE_PREFIX,
  SHELL_SCRIPT_ASSET,
  STALE_SCRIPT_CACHE_CONTROL,
} from "../src/worker/web/script-assets";
import { appRequest, createTestApp } from "./helpers/app";

const ASSETS = [
  SHELL_SCRIPT_ASSET,
  CONTENT_SCRIPT_ASSET,
  EXERCISE_SCRIPT_ASSET,
  REVIEW_SCRIPT_ASSET,
];

/**
 * The scripts are served rather than inlined, which only works if the URL in
 * the markup and the URL the route answers are derived from the same text. The
 * hash is what ties them together, so these are the assertions that keep an
 * `immutable` response honest.
 */
describe("script assets", () => {
  test("every asset resolves under its own href", () => {
    for (const asset of ASSETS) {
      expect(asset.href.startsWith(SCRIPT_ROUTE_PREFIX)).toBe(true);
      expect(asset.href.endsWith(".js")).toBe(true);
      expect(
        lookupScript(asset.href.slice(SCRIPT_ROUTE_PREFIX.length)),
      ).toEqual({ asset, current: true });
    }
  });

  test("distinct scripts get distinct URLs", () => {
    expect(new Set(ASSETS.map((asset) => asset.href)).size).toBe(
      ASSETS.length,
    );
  });

  test("a superseded hash still resolves, but as stale", () => {
    const stale = lookupScript("shell.000000.js");

    expect(stale?.asset).toBe(SHELL_SCRIPT_ASSET);
    expect(stale?.current).toBe(false);
  });

  test("an unknown name is a miss", () => {
    expect(lookupScript("nonesuch.000000.js")).toBeNull();
  });

  /**
   * What each file has to carry, asserted here because the pages that link them
   * no longer contain a line of it. These are the hooks other tests used to
   * find in the rendered HTML.
   */
  test("each asset carries the behaviour its document needs", () => {
    expect(CONTENT_SCRIPT_ASSET.js).toContain("/assets/components/");
    expect(CONTENT_SCRIPT_ASSET.js).toContain("carnap:content-height");
    // Folded in from the deep-link return page, guarded so it is inert on the
    // every other page the shell script also loads on.
    expect(SHELL_SCRIPT_ASSET.js).toContain("lti-deep-link-return");
    expect(SHELL_SCRIPT_ASSET.js).toContain("HTMLFormElement");
    expect(EXERCISE_SCRIPT_ASSET.js).toContain("beforeunload");
  });

  test("no asset carries a script tag", () => {
    for (const asset of ASSETS) {
      expect(asset.js).not.toContain("<script");
      expect(asset.js).not.toContain("</script>");
    }
  });
});

/**
 * No storage here on purpose: the route is mounted ahead of the middleware, so
 * serving a script must not need a database, a session, or a locale. A test
 * that passed only with an env wired up would be hiding a regression.
 */
describe("the script route", () => {
  test("serves the current hash as immutable", async () => {
    const response = await appRequest(
      createTestApp(),
      SHELL_SCRIPT_ASSET.href,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "text/javascript; charset=utf-8",
    );
    expect(response.headers.get("Cache-Control")).toBe(SCRIPT_CACHE_CONTROL);
    expect(await response.text()).toBe(SHELL_SCRIPT_ASSET.js);
  });

  test("serves a superseded hash, briefly", async () => {
    // A reader can arrive at markup from the deploy before this one, so the old
    // URL must still answer — with the current bytes, and not be kept.
    const response = await appRequest(
      createTestApp(),
      `${SCRIPT_ROUTE_PREFIX}shell.000000.js`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(
      STALE_SCRIPT_CACHE_CONTROL,
    );
    expect(await response.text()).toBe(SHELL_SCRIPT_ASSET.js);
  });

  test("an unknown name is a 404", async () => {
    const response = await appRequest(
      createTestApp(),
      `${SCRIPT_ROUTE_PREFIX}nonesuch.000000.js`,
    );

    expect(response.status).toBe(404);
  });
});
