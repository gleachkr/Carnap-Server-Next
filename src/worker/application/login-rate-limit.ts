import { createAppId } from "../domain/ids";
import { addSeconds, timestampNow } from "../domain/time";
import { deferred } from "../i18n/deferred";
import { AppHttpError } from "./errors";
import type { AuthStore, RecordLoginRateLimitHitInput } from "./stores";
import { hashAuthToken } from "./tokens";

export interface LoginRateLimitInput {
  readonly email: string;
  readonly ipAddress: string | null;
}

export interface LoginRateLimiter {
  /** Charge this request against its budgets, or throw 429 if either is spent. */
  check(input: LoginRateLimitInput): Promise<void>;
}

/**
 * The rolling window both limits are counted over. One window rather than a
 * short burst limit plus a long sustained one, because the thing being rationed
 * is a single scarce resource — outbound mail — and one number per key says all
 * that needs saying about it.
 */
export const LOGIN_RATE_LIMIT_WINDOW_SECONDS = 15 * 60;

/**
 * How many login emails one address may receive per window.
 *
 * Deliberately small. A link lives ten minutes (`LOGIN_TTL_SECONDS`), so a
 * person who asked five times in a quarter of an hour has unexpired links in
 * the mailbox already and a sixth would not help them. What this bounds is the
 * other case — somebody typing a stranger's address into the form over and
 * over, whose whole effect is to fill that stranger's inbox.
 */
export const LOGIN_RATE_LIMIT_PER_EMAIL = 5;

/**
 * How many login emails one client IP may cause per window.
 *
 * Much larger than the per-address limit, and larger than it looks like it
 * needs to be, because a shared egress address is the normal case in this
 * product's setting: a lecture hall on campus wifi, a school behind one NAT, a
 * lab of machines. Those are the people this must not lock out, and the address
 * limit is what actually protects any individual mailbox. This one exists to
 * stop the trivial script that walks a list of addresses from a single host —
 * which it does at 40, and which no amount of tightening would stop from a
 * botnet anyway.
 */
export const LOGIN_RATE_LIMIT_PER_IP = 40;

export interface StoredLoginRateLimiterOptions {
  readonly auth: AuthStore;
  readonly now?: () => Date;
  readonly perEmail?: number;
  readonly perIpAddress?: number;
  readonly windowSeconds?: number;
}

/**
 * A scope-tagged hash, which is what actually goes in the table.
 *
 * The scope tag keeps the two counters from ever colliding — an address and an
 * IP hash to different digests anyway, but a key that says which it is can be
 * read in a debugging session without guessing. The hash is the point: the
 * limiter only ever asks whether two requests carry the *same* address or IP,
 * and a digest answers that exactly as well as the plaintext, without turning
 * the throttle into a standing record of who tried to sign in from where.
 */
async function bucketKey(scope: string, value: string): Promise<string> {
  return `${scope}:${await hashAuthToken(value)}`;
}

function tooManyLoginRequests(): AppHttpError {
  return new AppHttpError(
    429,
    "login_rate_limited",
    deferred.i18n.t(
      "Too many sign-in links have been requested. Check your inbox — a link sent in the last few minutes still works — or try again shortly.",
    ),
  );
}

/**
 * The real limiter: a rolling count of login emails per address and per client
 * IP, held in the one database both hosts already have.
 *
 * A stored counter rather than Cloudflare's rate-limiting binding because a
 * self-hosted instance has no such binding, and a limiter that only defends the
 * deployed Worker would leave every self-hoster's mail quota open. The table
 * costs one indexed read and one write per login attempt, on a path that is
 * about to send an email — the cheapest thing that happens there.
 *
 * A hit is charged when a link is *issued*, not when one is asked for. So a
 * throttled requester who waits does get back in as their earlier hits age out,
 * and an attacker cannot hold a shared campus address locked by hammering it.
 * What the count tracks is exactly the quantity being protected: mail sent.
 *
 * Read-then-write, with no lock, so two requests arriving together can both see
 * the last free slot and take it. That is the right trade here: the failure is
 * bounded by concurrency (a handful of extra emails, once), while a lock on the
 * login path would be a new way for signing in to fall over. A throttle only
 * has to make the abuse uneconomic, not count perfectly.
 */
export function createStoredLoginRateLimiter(
  options: StoredLoginRateLimiterOptions,
): LoginRateLimiter {
  const windowSeconds =
    options.windowSeconds ?? LOGIN_RATE_LIMIT_WINDOW_SECONDS;
  const perEmail = options.perEmail ?? LOGIN_RATE_LIMIT_PER_EMAIL;
  const perIpAddress = options.perIpAddress ?? LOGIN_RATE_LIMIT_PER_IP;

  return {
    async check(input: LoginRateLimitInput): Promise<void> {
      const nowDate = options.now?.() ?? new Date();
      const windowStart = addSeconds(nowDate, -windowSeconds);
      const limits: { bucket: string; limit: number }[] = [
        { bucket: await bucketKey("email", input.email), limit: perEmail },
      ];

      // Absent behind a proxy that forwards no client address, in which case
      // the address limit carries this request on its own.
      if (input.ipAddress !== null) {
        limits.push({
          bucket: await bucketKey("ip", input.ipAddress),
          limit: perIpAddress,
        });
      }

      const counts = await options.auth.countLoginRateLimitHits(
        limits.map((entry) => entry.bucket),
        windowStart,
      );

      if (
        limits.some((entry) => (counts[entry.bucket] ?? 0) >= entry.limit)
      ) {
        throw tooManyLoginRequests();
      }

      const createdAt = timestampNow(nowDate);
      const hits: RecordLoginRateLimitHitInput[] = limits.map((entry) => ({
        id: createAppId(nowDate.getTime()),
        bucket: entry.bucket,
        createdAt,
      }));

      await options.auth.recordLoginRateLimitHits(hits, windowStart);
    },
  };
}
