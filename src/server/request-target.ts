import { logEvent } from "../worker/log";

/** Long enough for a scanner's probe to be recognisable, short of a flood. */
const LOGGED_TARGET_LENGTH = 512;

/**
 * The 400 for a request Bun could not give an absolute URL, or null for one it
 * could, which is every request a browser or a proxy sends.
 *
 * Bun builds `request.url` from the `Host` header. A request without one (an
 * HTTP/1.0 probe, an empty `Host:`) arrives as its bare path, `/QUALYS1`, and
 * a `CONNECT` as its bare authority, `10.0.0.5:80`. Everything downstream, Hono's
 * router included, reads the URL as absolute, as the Fetch API promises and
 * Cloudflare always delivers, so such a request fails wherever it is first
 * parsed. One of those places is the error handler's own log line, which then
 * throws in turn and loses the request. Refused here, it gets a 400 and is
 * logged once, with enough to identify the sender.
 *
 * `ip` is the socket's peer, never a forwarding header: a request that reaches
 * the port without a `Host` did not come through a proxy, which always sends
 * one.
 */
export function unroutableRequest(
  request: Pick<Request, "headers" | "method" | "url">,
  ip: string | null,
): Response | null {
  if (isAbsoluteHttpUrl(request.url)) {
    return null;
  }

  logEvent("warn", "request_target_rejected", {
    method: request.method,
    target: request.url.slice(0, LOGGED_TARGET_LENGTH),
    ip: ip ?? undefined,
    userAgent: request.headers.get("User-Agent") ?? undefined,
  });

  return new Response("Bad Request\n", {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
    status: 400,
  });
}

function isAbsoluteHttpUrl(target: string): boolean {
  if (!URL.canParse(target)) {
    return false;
  }

  const { protocol } = new URL(target);

  return protocol === "http:" || protocol === "https:";
}
