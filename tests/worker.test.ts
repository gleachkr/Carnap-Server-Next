import { describe, expect, spyOn, test } from "bun:test";

import { REQUEST_ID_HEADER } from "../src/worker/http";
import { appRequest, createTestApp } from "./helpers/app";

interface ErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly requestId: string;
  };
}

describe("worker app", () => {
  test("health endpoint returns a successful response", async () => {
    const response = await appRequest(createTestApp(), "/health");
    const body = (await response.json()) as { status: string };

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: "ok" });
    expect(response.headers.get(REQUEST_ID_HEADER)).toBeString();
  });

  test("request ID middleware preserves an incoming request ID", async () => {
    const requestId = "request-id-from-caller";
    const response = await appRequest(createTestApp(), "/health", {
      headers: {
        [REQUEST_ID_HEADER]: requestId,
      },
    });

    expect(response.headers.get(REQUEST_ID_HEADER)).toBe(requestId);
  });

  test("unknown routes return a consistent 404 response", async () => {
    const response = await appRequest(createTestApp(), "/missing");
    const body = (await response.json()) as ErrorEnvelope;

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("not_found");
    expect(body.error.message).toBe("The requested resource was not found.");
    expect(body.error.requestId).toBeString();
  });

  test("thrown errors return a consistent internal error", async () => {
    const app = createTestApp({
      configure(configuredApp) {
        configuredApp.get("/boom", () => {
          throw new Error("boom");
        });
      },
    });

    const response = await appRequest(app, "/boom");
    const body = (await response.json()) as ErrorEnvelope;

    expect(response.status).toBe(500);
    expect(body.error.code).toBe("internal_error");
    expect(body.error.message).toBe("An unexpected error occurred.");
    expect(body.error.requestId).toBeString();
  });

  /**
   * The envelope has always carried a `requestId`, and until this it appeared
   * in no log: the identifier a reader is invited to quote back correlated with
   * nothing an operator could look at.
   */
  test("a 500 leaves a log line the response's requestId can be found by", async () => {
    const logged = spyOn(console, "error").mockImplementation(() => {});

    try {
      const app = createTestApp({
        configure(configuredApp) {
          configuredApp.get("/boom", () => {
            throw new Error("boom");
          });
        },
      });
      const response = await appRequest(app, "/boom?token=not-in-the-log");
      const body = (await response.json()) as ErrorEnvelope;
      const line = logged.mock.calls.find(
        ([label]) => label === "request_failed",
      );
      const context = line?.[1] as Record<string, unknown>;

      expect(context?.requestId).toBe(body.error.requestId);
      expect(context?.message).toBe("boom");
      expect(context?.stack).toBeString();
      // A login confirmation link carries its single-use token in the query
      // string, so the path is logged without one.
      expect(context?.path).toBe("/boom");
      expect(JSON.stringify(context)).not.toContain("not-in-the-log");
    } finally {
      logged.mockRestore();
    }
  });

  test("a 404 is not a defect, and is not logged", async () => {
    const logged = spyOn(console, "error").mockImplementation(() => {});

    try {
      await appRequest(createTestApp(), "/missing");

      expect(logged).not.toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });

  test("test helper can call the app without starting a server", async () => {
    const response = await appRequest(createTestApp(), "/health");

    expect(response.ok).toBe(true);
  });
});
