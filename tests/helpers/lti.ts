import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWK,
  SignJWT,
} from "jose";

import type { AppStores } from "../../src/worker/application/stores";
import type { LtiDeployment, LtiPlatform } from "../../src/worker/domain/lti";
import type { Env } from "../../src/worker/env";
import type { WorkerApp } from "../../src/worker/http";
import { createTestApp } from "./app";

// The test suite declares the claim URIs independently of the application so
// a typo in either side fails a test instead of matching itself.
export const CLAIM_MESSAGE_TYPE =
  "https://purl.imsglobal.org/spec/lti/claim/message_type";
export const CLAIM_VERSION =
  "https://purl.imsglobal.org/spec/lti/claim/version";
export const CLAIM_DEPLOYMENT_ID =
  "https://purl.imsglobal.org/spec/lti/claim/deployment_id";
export const CLAIM_RESOURCE_LINK =
  "https://purl.imsglobal.org/spec/lti/claim/resource_link";
export const CLAIM_ROLES = "https://purl.imsglobal.org/spec/lti/claim/roles";
export const CLAIM_CONTEXT =
  "https://purl.imsglobal.org/spec/lti/claim/context";
export const CLAIM_AGS_ENDPOINT =
  "https://purl.imsglobal.org/spec/lti-ags/claim/endpoint";

export const INSTRUCTOR_ROLE =
  "http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor";
export const LEARNER_ROLE =
  "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner";
export const TEACHING_ASSISTANT_ROLE =
  "http://purl.imsglobal.org/vocab/lis/v2/membership/Instructor#TeachingAssistant";
export const CONTENT_DEVELOPER_ROLE =
  "http://purl.imsglobal.org/vocab/lis/v2/membership#ContentDeveloper";

export const TEST_ISSUER = "https://lms.example.test";
export const TEST_CLIENT_ID = "carnap-client-1";
export const TEST_DEPLOYMENT_ID = "deployment-1";

const NOW = "2026-01-02T03:04:05.000Z";

interface TestKeys {
  readonly privateKey: CryptoKey;
  readonly publicJwk: JWK;
}

let cachedKeys: Promise<TestKeys> | null = null;

/** One RSA key pair per test process; generation is the slow part. */
export function testPlatformKeys(): Promise<TestKeys> {
  cachedKeys ??= (async () => {
    const pair = await generateKeyPair("RS256", { extractable: true });
    const publicJwk = await exportJWK(pair.publicKey);

    publicJwk.alg = "RS256";
    publicJwk.kid = "lti-test-key";

    return { privateKey: pair.privateKey, publicJwk };
  })();

  return cachedKeys;
}

/** An app whose LTI routes verify tokens against the process-local test key. */
export async function createLtiTestApp(): Promise<WorkerApp> {
  const keys = await testPlatformKeys();
  const keySet = createLocalJWKSet({ keys: [keys.publicJwk] });

  return createTestApp({ lti: { keyResolver: () => keySet } });
}

export interface TestPlatformFixture {
  readonly deployment: LtiDeployment;
  readonly platform: LtiPlatform;
}

export async function registerTestPlatform(
  stores: AppStores,
  overrides: {
    readonly clientId?: string;
    readonly deploymentId?: string;
    readonly issuer?: string;
  } = {},
): Promise<TestPlatformFixture> {
  const issuer = overrides.issuer ?? TEST_ISSUER;
  const clientId = overrides.clientId ?? TEST_CLIENT_ID;
  const platform = await stores.lti.createPlatform({
    id: `lti-platform-${clientId}`,
    name: "Test LMS",
    issuer,
    clientId,
    authorizationEndpoint: `${issuer}/auth`,
    tokenEndpoint: `${issuer}/token`,
    jwksUri: `${issuer}/jwks`,
    createdAt: NOW,
  });
  const deployment = await stores.lti.createDeployment({
    id: `lti-deployment-${clientId}`,
    platformId: platform.id,
    deploymentId: overrides.deploymentId ?? TEST_DEPLOYMENT_ID,
    name: "Test deployment",
    createdAt: NOW,
  });

  return { deployment, platform };
}

export interface MintIdTokenOptions {
  readonly audience?: string | string[];
  readonly azp?: string;
  /** Extra or overriding claims, applied last. */
  readonly claims?: Record<string, unknown>;
  readonly context?: { readonly id: string; readonly title?: string } | null;
  readonly deploymentId?: string;
  /** null omits the claim entirely. */
  readonly email?: string | null;
  readonly expiresAt?: number;
  readonly issuer?: string;
  readonly messageType?: string;
  readonly name?: string | null;
  readonly nonce: string;
  readonly resourceLink?: {
    readonly id: string;
    readonly title?: string;
  } | null;
  readonly roles?: readonly string[];
  readonly sub?: string;
  readonly version?: string;
}

export async function mintIdToken(
  options: MintIdTokenOptions,
): Promise<string> {
  const context =
    options.context === undefined
      ? { id: "lms-course-1", title: "Intro Logic (LMS)" }
      : options.context;
  const payload: Record<string, unknown> = {
    nonce: options.nonce,
    [CLAIM_MESSAGE_TYPE]: options.messageType ?? "LtiResourceLinkRequest",
    [CLAIM_VERSION]: options.version ?? "1.3.0",
    [CLAIM_DEPLOYMENT_ID]: options.deploymentId ?? TEST_DEPLOYMENT_ID,
    [CLAIM_ROLES]: options.roles ?? [LEARNER_ROLE],
  };

  if (context !== null) {
    payload[CLAIM_CONTEXT] = context;
  }

  if (options.resourceLink !== undefined && options.resourceLink !== null) {
    payload[CLAIM_RESOURCE_LINK] = options.resourceLink;
  }

  if (options.email !== null) {
    payload.email = options.email ?? "learner@example.test";
  }

  if (options.name !== null) {
    payload.name = options.name ?? "Test Learner";
  }

  if (options.azp !== undefined) {
    payload.azp = options.azp;
  }

  Object.assign(payload, options.claims ?? {});

  const jwt = new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: "lti-test-key" })
    .setIssuer(options.issuer ?? TEST_ISSUER)
    .setAudience(options.audience ?? TEST_CLIENT_ID)
    .setSubject(options.sub ?? "lms-user-1")
    .setIssuedAt();

  if (options.expiresAt !== undefined) {
    jwt.setExpirationTime(options.expiresAt);
  } else {
    jwt.setExpirationTime("5m");
  }

  return jwt.sign((await testPlatformKeys()).privateKey);
}

export function formRequest(
  fields: Record<string, string>,
  extraHeaders: Readonly<Record<string, string>> = {},
): RequestInit {
  return {
    body: new URLSearchParams(fields).toString(),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...extraHeaders,
    },
    method: "POST",
  };
}

/**
 * Run the OIDC initiation leg: hit /lti/login and pull the state and nonce
 * out of the authorization redirect the way a platform would.
 */
export async function beginTestLogin(
  app: WorkerApp,
  env: Env,
  overrides: {
    readonly clientId?: string | null;
    readonly issuer?: string;
  } = {},
): Promise<{ readonly nonce: string; readonly state: string }> {
  const params = new URLSearchParams({
    iss: overrides.issuer ?? TEST_ISSUER,
    login_hint: "lms-user-1",
    target_link_uri: "http://localhost/lti/launch",
  });

  if (overrides.clientId !== null) {
    params.set("client_id", overrides.clientId ?? TEST_CLIENT_ID);
  }

  const response = await app.request(
    `/lti/login?${params.toString()}`,
    {},
    env,
  );

  if (response.status !== 302) {
    throw new Error(
      `Login initiation failed with status ${response.status}: ${await response.text()}`,
    );
  }

  const location = response.headers.get("Location");

  if (location === null) {
    throw new Error("Login initiation returned no redirect location.");
  }

  const url = new URL(location);
  const state = url.searchParams.get("state");
  const nonce = url.searchParams.get("nonce");

  if (state === null || nonce === null) {
    throw new Error("Authorization redirect is missing state or nonce.");
  }

  return { nonce, state };
}

export interface LaunchResult {
  readonly cookieHeader: string | null;
  readonly csrfToken: string | null;
  readonly response: Response;
}

function launchCookies(response: Response): {
  readonly cookieHeader: string | null;
  readonly csrfToken: string | null;
} {
  const headers = response.headers as Headers & {
    readonly getSetCookie?: () => string[];
  };
  const setCookies =
    headers.getSetCookie?.() ??
    (headers.get("set-cookie") ?? "").split(/,(?=\s*[^;=]+=)/);
  const pairs = setCookies
    .map((cookie) => cookie.split(";")[0]?.trim() ?? "")
    .filter((pair) => pair.includes("="));

  if (pairs.length === 0) {
    return { cookieHeader: null, csrfToken: null };
  }

  const csrfPair = pairs.find((pair) => pair.startsWith("carnap_csrf="));

  return {
    cookieHeader: pairs.join("; "),
    csrfToken: csrfPair?.slice("carnap_csrf=".length) ?? null,
  };
}

/**
 * Run a complete launch: initiation, token minting with the returned nonce,
 * and the form_post to /lti/launch. Token fields can be overridden to drive
 * every negative case in the milestone's test list.
 */
export async function performLaunch(
  app: WorkerApp,
  env: Env,
  overrides: Omit<MintIdTokenOptions, "nonce"> & {
    /**
     * Extra headers on the launch POST. A launch that answers with a page
     * rather than a redirect (link-pending, Deep Linking) renders in the
     * request's language, so the pseudolocale fixtures must set it here.
     */
    readonly headers?: Readonly<Record<string, string>>;
    readonly nonce?: string;
    /**
     * Origin for the launch POST itself, for the one property that turns on
     * the connection rather than on anything in the token: whether the session
     * it mints may carry `Secure`, and so `SameSite=None` (see `cookieSecure`).
     * Everything else here is plain-http localhost.
     */
    readonly origin?: string;
    readonly state?: string;
  } = {},
): Promise<LaunchResult> {
  const login = await beginTestLogin(app, env);
  const { headers, nonce, origin, state, ...tokenOverrides } = overrides;
  const idToken = await mintIdToken({
    ...tokenOverrides,
    nonce: nonce ?? login.nonce,
  });
  const response = await app.request(
    `${origin ?? ""}/lti/launch`,
    formRequest(
      { id_token: idToken, state: state ?? login.state },
      { Accept: "text/html", ...headers },
    ),
    env,
  );

  return { ...launchCookies(response), response };
}
