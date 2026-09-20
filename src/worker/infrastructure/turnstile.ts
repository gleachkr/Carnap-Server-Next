import type { Context } from "hono";

import type {
  TurnstileVerifier,
  VerifyTurnstileInput,
} from "../application/auth";
import { AppHttpError } from "../application/errors";
import type { Env } from "../env";
import type { AppBindings } from "../http";
import { deferred } from "../i18n/deferred";
import { withUserAgent } from "../user-agent";
import { type Fetcher, platformFetcher } from "./fetch";

/**
 * Where a token is redeemed. One redemption per token — Turnstile answers a
 * replay with `timeout-or-duplicate` — which is what makes "a token per
 * request" mean a *solve* per request rather than one solve reused forever.
 */
const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

interface SiteverifyResponse {
  readonly "error-codes"?: unknown;
  readonly success?: unknown;
}

/**
 * Codes that mean the *deployment* is broken rather than the request: a
 * missing or mistyped secret fails every login identically, and answering it
 * with "the check did not pass, try again" would send each of those readers
 * back around a loop that cannot end. Named so the operator's error log says
 * which key to fix.
 */
const SECRET_ERROR_CODES = new Set([
  "invalid-input-secret",
  "missing-input-secret",
]);

export interface CloudflareTurnstileVerifierOptions {
  readonly fetcher?: Fetcher;
  readonly secretKey: string;
}

function challengeMissing(): AppHttpError {
  return new AppHttpError(
    403,
    "login_challenge_missing",
    deferred.i18n.t(
      "Complete the verification check to request a login link. If no check appeared on the form, enable JavaScript and reload the page.",
    ),
  );
}

function challengeFailed(): AppHttpError {
  return new AppHttpError(
    403,
    "login_challenge_failed",
    deferred.i18n.t(
      "The verification check did not pass or has expired. Please try again.",
    ),
  );
}

function challengeUnavailable(): AppHttpError {
  return new AppHttpError(
    500,
    "login_challenge_unavailable",
    deferred.i18n.t(
      "The verification service could not be reached. Please try again shortly.",
    ),
  );
}

function challengeMisconfigured(): AppHttpError {
  return new AppHttpError(
    500,
    "login_challenge_misconfigured",
    deferred.i18n.t(
      "Human verification is misconfigured for this deployment.",
    ),
  );
}

/**
 * Redeems a widget token against Cloudflare's siteverify endpoint.
 *
 * A plain HTTPS POST on purpose: it works identically from the deployed
 * Worker and from a self-hosted Bun container, for the same reason the login
 * throttle is a stored counter rather than a Workers binding. What it cannot
 * do is work air-gapped — an instance that must not call out leaves the keys
 * unset and keeps the tight per-IP throttle instead.
 *
 * An unreachable or erroring endpoint fails *closed*. Open would mean anyone
 * who can induce a verification failure has switched the gate off, and the
 * cost of closed is bounded: a Cloudflare outage pauses new login links, not
 * signed-in sessions.
 */
export class CloudflareTurnstileVerifier implements TurnstileVerifier {
  private readonly fetcher: Fetcher;

  constructor(private readonly options: CloudflareTurnstileVerifierOptions) {
    this.fetcher = options.fetcher ?? platformFetcher;
  }

  async verify(input: VerifyTurnstileInput): Promise<void> {
    if (input.token === null || input.token.length === 0) {
      throw challengeMissing();
    }

    let response: Response;

    try {
      response = await this.fetcher(SITEVERIFY_URL, {
        body: JSON.stringify({
          // Corroboration, not identification: siteverify compares it with
          // the address the challenge was solved from.
          ...(input.ipAddress === null ? {} : { remoteip: input.ipAddress }),
          response: input.token,
          secret: this.options.secretKey,
        }),
        headers: withUserAgent({ "Content-Type": "application/json" }),
        method: "POST",
      });
    } catch (_error) {
      throw challengeUnavailable();
    }

    if (!response.ok) {
      throw challengeUnavailable();
    }

    let body: SiteverifyResponse;

    try {
      body = (await response.json()) as SiteverifyResponse;
    } catch (_error) {
      throw challengeUnavailable();
    }

    if (body.success === true) {
      return;
    }

    const errorCodes = Array.isArray(body["error-codes"])
      ? body["error-codes"].filter((code) => typeof code === "string")
      : [];

    if (errorCodes.some((code) => SECRET_ERROR_CODES.has(code))) {
      throw challengeMisconfigured();
    }

    throw challengeFailed();
  }
}

/**
 * The deployment's verifier, or null when the gate is not configured.
 *
 * Keyed on the *secret* alone, deliberately asymmetric with the widget
 * (which `web/auth.tsx` renders only when both keys are set): a secret
 * without a site key refuses every login loudly on the first test sign-in,
 * while enforcement keyed on the pair would let a typo'd site key silently
 * turn the gate off with the widget it disabled as the only witness.
 */
export function turnstileFromEnv(env: Env): TurnstileVerifier | null {
  return env.TURNSTILE_SECRET_KEY === undefined
    ? null
    : new CloudflareTurnstileVerifier({
        secretKey: env.TURNSTILE_SECRET_KEY,
      });
}

/**
 * What the login routes pass to `startNativeLogin`: the test seam's injected
 * verifier when one is riding on the context, the environment's otherwise.
 */
export function turnstileForContext(
  context: Context<AppBindings>,
): TurnstileVerifier | null {
  return context.get("turnstileVerifier") ?? turnstileFromEnv(context.env);
}
