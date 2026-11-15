import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  spyOn,
  test,
} from "bun:test";
import { connect } from "node:net";

import { unroutableRequest } from "../src/server/request-target";

/**
 * What the standalone server answers when Bun cannot give a request an
 * absolute URL. Driven over a real socket, because the requests that matter
 * cannot be built with `new Request` at all: the point is what Bun itself
 * hands over for a request line a browser would never send.
 */
describe("a request Bun cannot give an absolute URL", () => {
  type Line = Record<string, unknown>;

  const server = Bun.serve({
    fetch: (request) =>
      unroutableRequest(request, "203.0.113.7") ?? new Response("routed"),
    port: 0,
  });

  let warnings: Line[] = [];
  let spy: { mockRestore(): void } | undefined;

  beforeEach(() => {
    warnings = [];
    spy = spyOn(console, "warn").mockImplementation((line: unknown) => {
      warnings.push(JSON.parse(String(line)) as Line);
    });
  });

  afterEach(() => {
    spy?.mockRestore();
  });

  afterAll(() => {
    server.stop(true);
  });

  /** Send `head` as the whole request and return the status line and body. */
  async function send(
    head: string,
  ): Promise<{ body: string; status: string }> {
    const response = await new Promise<string>((resolve, reject) => {
      let received = "";
      const socket = connect(server.port ?? 0, "127.0.0.1", () => {
        socket.write(`${head}\r\n\r\n`);
      });

      socket.on("data", (chunk) => {
        received += chunk.toString();
      });
      socket.on("end", () => resolve(received));
      socket.on("error", reject);
    });
    const [headers = "", body = ""] = response.split("\r\n\r\n");

    return { body, status: headers.split("\r\n")[0] ?? "" };
  }

  test("an HTTP/1.0 request without Host is refused and logged", async () => {
    const { body, status } = await send(
      "GET /QUALYS1 HTTP/1.0\r\nUser-Agent: probe",
    );

    expect(status).toBe("HTTP/1.1 400 Bad Request");
    expect(body).toBe("Bad Request\n");
    expect(warnings).toEqual([
      expect.objectContaining({
        event: "request_target_rejected",
        ip: "203.0.113.7",
        method: "GET",
        target: "/QUALYS1",
        userAgent: "probe",
      }),
    ]);
  });

  test("an empty Host is refused", async () => {
    const { status } = await send(
      "GET / HTTP/1.1\r\nHost: \r\nConnection: close",
    );

    expect(status).toBe("HTTP/1.1 400 Bad Request");
    expect(warnings).toEqual([expect.objectContaining({ target: "/" })]);
  });

  test("a CONNECT is refused with its authority as the target", async () => {
    const { status } = await send(
      "CONNECT 10.41.68.238:80 HTTP/1.1\r\nHost: 10.41.68.238:80\r\nConnection: close",
    );

    expect(status).toBe("HTTP/1.1 400 Bad Request");
    expect(warnings).toEqual([
      expect.objectContaining({
        method: "CONNECT",
        target: "10.41.68.238:80",
      }),
    ]);
  });

  test("a Host the URL parser refuses is refused", async () => {
    const { status } = await send(
      "GET / HTTP/1.1\r\nHost: bad host\r\nConnection: close",
    );

    expect(status).toBe("HTTP/1.1 400 Bad Request");
  });

  test("an ordinary request is routed, and nothing is logged", async () => {
    const { body, status } = await send(
      "GET /login?next=%2Fcourses HTTP/1.1\r\nHost: carnap.test\r\nConnection: close",
    );

    expect(status).toBe("HTTP/1.1 200 OK");
    expect(body).toBe("routed");
    expect(warnings).toEqual([]);
  });
});
