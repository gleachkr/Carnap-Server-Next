import { describe, expect, test } from "bun:test";

import { SHELL_SCRIPT_ASSET } from "../src/worker/web/script-assets";
import { appRequest, createTestApp } from "./helpers/app";

/**
 * Spelled out rather than imported, so that changing the policy has to be
 * changing it twice — once where it ships and once here, where the diff is
 * legible to a reviewer who wants to know what a deploy just started
 * permitting.
 */
const EXPECTED_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https:",
  "font-src 'self' https:",
  "img-src 'self' data: https:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'self'",
].join("; ");

const EXPECTED = {
  "Content-Security-Policy": EXPECTED_POLICY,
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
};

function expectSecured(response: Response): void {
  for (const [name, value] of Object.entries(EXPECTED)) {
    expect(response.headers.get(name)).toBe(value);
  }
}

/**
 * The headers are worth as much as the responses they are missing from, so
 * these check the shapes a response can take rather than a page or two: one
 * built through the context, one returned raw by its handler, an asset served
 * ahead of the rest of the middleware, and the two failure paths.
 */
describe("security headers", () => {
  test("a page carries every one of them", async () => {
    const response = await appRequest(createTestApp(), "/login");

    expect(response.status).toBe(200);
    expectSecured(response);
  });

  test("a script asset carries them, though it answers before the middleware", async () => {
    const response = await appRequest(
      createTestApp(),
      SHELL_SCRIPT_ASSET.href,
    );

    expect(response.status).toBe(200);
    expectSecured(response);
  });

  test("a redirect carries them", async () => {
    // `redirect()` returns a `Response` of its own rather than building one
    // through the context, which is the case headers staged before `next()`
    // would silently miss.
    const response = await appRequest(createTestApp(), "/favicon.ico");

    expect(response.status).toBe(302);
    expectSecured(response);
  });

  test("a not-found page carries them", async () => {
    const response = await appRequest(createTestApp(), "/nothing-here");

    expect(response.status).toBe(404);
    expectSecured(response);
  });

  test("a thrown error carries them", async () => {
    const app = createTestApp({
      configure: (instance) => {
        instance.get("/boom", () => {
          throw new Error("boom");
        });
      },
    });
    const response = await appRequest(app, "/boom");

    expect(response.status).toBe(500);
    expectSecured(response);
  });

  /**
   * Deliberately absent: an LTI launch is rendered inside the LMS's iframe, and
   * `X-Frame-Options` has no origin list — `SAMEORIGIN` would break every
   * launch. Framing is `frame-ancestors`' job, and that directive is left out
   * of the policy for the same reason.
   */
  test("nothing sets X-Frame-Options", async () => {
    const response = await appRequest(createTestApp(), "/login");

    expect(response.headers.get("X-Frame-Options")).toBeNull();
  });

  test("the policy enforces, and is not also shipped report-only", async () => {
    // Both headers at once is a real configuration, and a confusing one: the
    // enforcing copy blocks while the report-only copy narrates, and a reader
    // of the console cannot tell which one just broke their page.
    const response = await appRequest(createTestApp(), "/login");

    expect(response.headers.get("Content-Security-Policy")).toBe(
      EXPECTED_POLICY,
    );
    expect(
      response.headers.get("Content-Security-Policy-Report-Only"),
    ).toBeNull();
  });

  /**
   * The shape of the policy, rather than its text: images, stylesheets and
   * fonts may come from any `https` origin because authors reference them from
   * lessons, but nothing that can *run* may. It is an easy line to erase by
   * accident — a future `connect-src https:` added to make one integration work
   * would read as a small edit and would hand every page the exfiltration
   * channel the rest of this is meant to deny.
   */
  test.each([
    "default-src",
    "script-src",
    "connect-src",
    "object-src",
    "frame-src",
  ])("%s admits no origin but our own", async (directive) => {
    const response = await appRequest(createTestApp(), "/login");
    const policy = response.headers.get("Content-Security-Policy");
    const clause = (policy ?? "")
      .split("; ")
      .find((entry) => entry.startsWith(`${directive} `));

    expect(clause).toBeDefined();
    expect(clause).not.toContain("https:");
    expect(clause).not.toContain("http:");
    expect(clause).not.toContain("*");
  });

  /**
   * Both of these would break something the product does, so their absence is
   * the assertion: `form-action` because the LTI deep-link return posts to the
   * LMS's own origin, `frame-ancestors` because a launch is framed by the LMS.
   */
  test.each([
    "form-action",
    "frame-ancestors",
  ])("the policy states no %s", async (directive) => {
    const response = await appRequest(createTestApp(), "/login");
    const policy = response.headers.get("Content-Security-Policy");

    expect(policy).not.toBeNull();
    expect(policy).not.toContain(directive);
  });
});
