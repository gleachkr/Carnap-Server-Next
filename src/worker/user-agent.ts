/**
 * How this server identifies itself on every request it makes to somebody
 * else's server.
 *
 * This is not decoration. Canvas enforces a `User-Agent` header at its edge
 * and answers an agentless request with a 403 whose body is an HTML error
 * page, not the JSON an API client expects — so a missing header does not
 * surface as "grade rejected", it surfaces as an unparseable reply from a
 * request that never reached Canvas at all. The check happens before routing,
 * so it covers the LTI Advantage endpoints (token, line items, scores) exactly
 * as it covers `/api/v1`.
 *
 * Workers is the reason we have to say this out loud: `fetch()` there sends no
 * `User-Agent` unless one is set, unlike curl, Bun, or a browser. A local
 * self-hosted run under Bun would send `Bun/x.y.z`, which passes the check but
 * tells the receiving admin nothing about who is calling.
 *
 * The URL in the comment form is the convention platforms expect for a robot:
 * an admin reading their logs can find out who we are without asking.
 */
export const OUTBOUND_USER_AGENT =
  "CarnapServer/1.0 (+https://github.com/gleachkr/Carnap-Server-Next)";

/**
 * Add our `User-Agent` to a set of request headers, leaving an explicit one
 * alone. Takes and returns the plain-object form the callers already build,
 * so adopting it is one wrapped expression at the `fetch` site.
 */
export function withUserAgent(
  headers: Record<string, string>,
): Record<string, string> {
  const alreadySet = Object.keys(headers).some(
    (name) => name.toLowerCase() === "user-agent",
  );

  return alreadySet
    ? headers
    : { ...headers, "User-Agent": OUTBOUND_USER_AGENT };
}
