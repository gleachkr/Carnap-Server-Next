import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setDefaultTimeout,
  spyOn,
  test,
} from "bun:test";

import { appRequest, createTestApp } from "./helpers/app";
import { login, withStorage } from "./helpers/http";

setDefaultTimeout(30_000);

/**
 * A form post whose body is not the form its `Content-Type` names. A scanner
 * sends these, a browser never does, and `formData()` throws on them: before
 * the routes read forms through `readForm`, each one was a 500 with a stack
 * trace in the log.
 */
describe("a form post the server cannot read", () => {
  let errors: unknown[] = [];
  let spy: { mockRestore(): void } | undefined;

  beforeEach(() => {
    errors = [];
    spy = spyOn(console, "error").mockImplementation((line: unknown) => {
      errors.push(line);
    });
  });

  afterEach(() => {
    spy?.mockRestore();
  });

  /** A multipart body that does not match the boundary it declares. */
  const BROKEN_MULTIPART: RequestInit = {
    body: "email=ada%40example.test",
    headers: { "Content-Type": "multipart/form-data; boundary=missing" },
    method: "POST",
  };

  test("is a 400 page for a browser, and not a server error", async () => {
    await withStorage(async (_storage, env) => {
      const response = await appRequest(
        createTestApp(),
        "/login",
        {
          ...BROKEN_MULTIPART,
          headers: {
            ...(BROKEN_MULTIPART.headers as Record<string, string>),
            Accept: "text/html",
          },
        },
        env,
      );

      expect(response.status).toBe(400);
      expect(response.headers.get("Content-Type")).toContain("text/html");
      expect(errors).toEqual([]);
    });
  });

  test("is a 400 with its own code for anything else", async () => {
    await withStorage(async (_storage, env) => {
      const response = await appRequest(
        createTestApp(),
        "/login",
        BROKEN_MULTIPART,
        env,
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "invalid_form" },
      });
      expect(errors).toEqual([]);
    });
  });

  test("from a signed-in user, fails the CSRF check when the token is in the body", async () => {
    await withStorage(async (_storage, env) => {
      const user = await login(env, "ada@example.test");
      const response = await appRequest(
        createTestApp(),
        "/profile",
        {
          ...BROKEN_MULTIPART,
          headers: {
            ...(BROKEN_MULTIPART.headers as Record<string, string>),
            Cookie: user.cookieHeader,
          },
        },
        env,
      );

      expect(response.status).toBe(403);
      expect(errors).toEqual([]);
    });
  });

  test("from a signed-in user with the token in its header, is a 400", async () => {
    await withStorage(async (_storage, env) => {
      const user = await login(env, "ada@example.test");
      const response = await appRequest(
        createTestApp(),
        "/profile",
        {
          ...BROKEN_MULTIPART,
          headers: {
            ...(BROKEN_MULTIPART.headers as Record<string, string>),
            Cookie: user.cookieHeader,
            "X-CSRF-Token": user.csrfToken,
          },
        },
        env,
      );

      expect(response.status).toBe(400);
      expect(errors).toEqual([]);
    });
  });
});
