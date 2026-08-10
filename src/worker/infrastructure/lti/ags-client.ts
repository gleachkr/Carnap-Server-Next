import { SignJWT } from "jose";

import type {
  LtiScoreMessage,
  LtiScoreSender,
} from "../../application/grade-passback";
import { ScoreDeliveryError } from "../../application/grade-passback";
import type { LtiGradeFailureReason, LtiPlatform } from "../../domain/lti";
import type { LtiToolKey } from "./tool-key";

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export const AGS_SCORE_SCOPE =
  "https://purl.imsglobal.org/spec/lti-ags/scope/score";

const CLIENT_ASSERTION_TYPE =
  "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";

/** How long a signed client assertion stays valid. */
const ASSERTION_TTL_SECONDS = 300;

/** Refuse to reuse a cached token this close to its expiry. */
const TOKEN_EXPIRY_MARGIN_MS = 30_000;

export interface AgsClientOptions {
  readonly fetcher?: Fetcher;
  readonly now?: () => Date;
  readonly toolKey: LtiToolKey;
}

interface CachedToken {
  readonly accessToken: string;
  readonly expiresAtMs: number;
}

/**
 * The outbound half of Assignment and Grade Services: trade a signed client
 * assertion for a platform access token (cached per platform for the client's
 * lifetime), then POST scores to a line item's scores endpoint.
 */
export class AgsClient implements LtiScoreSender {
  private readonly fetcher: Fetcher;
  private readonly tokens = new Map<string, CachedToken>();

  constructor(private readonly options: AgsClientOptions) {
    // Wrapped rather than referenced: calling an unbound global `fetch`
    // through a property throws "Illegal invocation" on Workers.
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  }

  async postScore(
    platform: LtiPlatform,
    lineItemUrl: string,
    score: LtiScoreMessage,
  ): Promise<void> {
    let response = await this.sendScore(platform, lineItemUrl, score);

    if (response.status === 401) {
      // The platform may have revoked the cached token early; retry once
      // with a freshly minted one before treating the rejection as real.
      this.tokens.delete(platform.id);
      response = await this.sendScore(platform, lineItemUrl, score);
    }

    if (!response.ok) {
      throw await deliveryError("lms_rejected", response);
    }
  }

  private async sendScore(
    platform: LtiPlatform,
    lineItemUrl: string,
    score: LtiScoreMessage,
  ): Promise<Response> {
    const accessToken = await this.accessToken(platform);

    return this.send(scoresUrl(lineItemUrl), {
      body: JSON.stringify({
        userId: score.subject,
        scoreGiven: score.scoreGiven,
        scoreMaximum: score.scoreMaximum,
        activityProgress: "Completed",
        gradingProgress: "FullyGraded",
        timestamp: score.timestamp,
      }),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/vnd.ims.lis.v1.score+json",
      },
      method: "POST",
    });
  }

  private async accessToken(platform: LtiPlatform): Promise<string> {
    const nowMs = (this.options.now?.() ?? new Date()).getTime();
    const cached = this.tokens.get(platform.id);

    if (
      cached !== undefined &&
      cached.expiresAtMs - TOKEN_EXPIRY_MARGIN_MS > nowMs
    ) {
      return cached.accessToken;
    }

    const nowSeconds = Math.floor(nowMs / 1000);
    const header: { alg: string; kid?: string } = {
      alg: this.options.toolKey.alg,
    };

    if (this.options.toolKey.kid !== undefined) {
      header.kid = this.options.toolKey.kid;
    }

    const assertion = await new SignJWT({})
      .setProtectedHeader(header)
      .setIssuer(platform.clientId)
      .setSubject(platform.clientId)
      .setAudience(platform.tokenEndpoint)
      .setIssuedAt(nowSeconds)
      .setExpirationTime(nowSeconds + ASSERTION_TTL_SECONDS)
      .setJti(crypto.randomUUID())
      .sign(this.options.toolKey.key);
    const response = await this.send(platform.tokenEndpoint, {
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_assertion_type: CLIENT_ASSERTION_TYPE,
        client_assertion: assertion,
        scope: AGS_SCORE_SCOPE,
      }).toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
    });

    if (!response.ok) {
      throw await deliveryError("lms_token_refused", response);
    }

    let accessToken: unknown;
    let expiresIn: unknown;

    try {
      const body = (await response.json()) as Record<string, unknown>;

      accessToken = body.access_token;
      expiresIn = body.expires_in;
    } catch (_error) {
      accessToken = undefined;
    }

    if (typeof accessToken !== "string" || accessToken.length === 0) {
      // A 200 with an unreadable body is more likely a proxy hiccup than a
      // permanent misconfiguration, so leave the retry path open.
      throw new ScoreDeliveryError("lms_token_unreadable", true);
    }

    const ttlSeconds = typeof expiresIn === "number" ? expiresIn : 3600;

    this.tokens.set(platform.id, {
      accessToken,
      expiresAtMs: nowMs + ttlSeconds * 1000,
    });

    return accessToken;
  }

  private async send(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetcher(url, init);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "fetch failed";

      throw new ScoreDeliveryError("lms_unreachable", true, detail);
    }
  }
}

/**
 * The scores endpoint lives at `{lineitem}/scores`, but platforms (Moodle
 * included) key the line item through its query string, so the suffix must
 * extend the path with the query preserved — not be appended to the string.
 */
function scoresUrl(lineItemUrl: string): string {
  const url = new URL(lineItemUrl);

  url.pathname = `${url.pathname}/scores`;

  return url.href;
}

/**
 * Turn a rejected response into a delivery error. The reason is ours and
 * translatable; the detail is the platform's status line and body, kept as-is
 * so staff can see what the LMS actually said.
 */
async function deliveryError(
  reason: LtiGradeFailureReason,
  response: Response,
): Promise<ScoreDeliveryError> {
  const retryable =
    response.status >= 500 ||
    response.status === 429 ||
    response.status === 408;
  let body = "";

  try {
    body = (await response.text()).slice(0, 200);
  } catch (_error) {
    body = "";
  }

  return new ScoreDeliveryError(
    reason,
    retryable,
    `HTTP ${response.status}${body.length > 0 ? `: ${body}` : ""}`,
  );
}
