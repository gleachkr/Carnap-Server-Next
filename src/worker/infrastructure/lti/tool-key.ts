import { importJWK, type JWK } from "jose";

/** The tool's private signing key, imported and ready to sign with. */
export interface LtiToolKey {
  readonly alg: string;
  readonly kid: string | undefined;
  readonly key: CryptoKey;
  /**
   * The public half, as `/lti/jwks` publishes it. Built here, from the same
   * parse that produced `key`, so that a key is advertised exactly when it
   * can sign: a secret this loader refuses is published as nothing.
   */
  readonly publicJwk: JWK;
}

/**
 * The public members of an asymmetric JWK. Copying an allowlist (instead of
 * stripping known private members) fails closed: a key type whose private
 * fields we did not anticipate publishes nothing rather than everything.
 */
const PUBLIC_JWK_MEMBERS = [
  "kty",
  "use",
  "alg",
  "kid",
  "n",
  "e",
  "crv",
  "x",
  "y",
] as const;

/** Whether `LTI_TOOL_PRIVATE_KEY` is set at all — configured, if not usable. */
export function ltiToolKeyConfigured(raw: string | undefined): raw is string {
  return raw !== undefined && raw.trim().length > 0;
}

/**
 * Parse `LTI_TOOL_PRIVATE_KEY` (a JSON JWK) into a signing key. Returns null
 * for anything unusable — unset, unparseable, symmetric, or malformed — so
 * callers can report "tool key not configured" instead of crashing.
 */
export async function loadLtiToolKey(
  raw: string | undefined,
): Promise<LtiToolKey | null> {
  if (!ltiToolKeyConfigured(raw)) {
    return null;
  }

  let jwk: JWK;

  try {
    jwk = JSON.parse(raw) as JWK;
  } catch (_error) {
    return null;
  }

  if (typeof jwk !== "object" || jwk === null) {
    return null;
  }

  // A symmetric key has no public half to publish and nothing an LMS could
  // verify against; a whole JWKS pasted in has no `kty` at the top.
  if (typeof jwk.kty !== "string" || jwk.kty === "oct") {
    return null;
  }

  const alg = typeof jwk.alg === "string" ? jwk.alg : "RS256";

  try {
    const key = await importJWK(jwk, alg);

    if (key instanceof Uint8Array) {
      return null;
    }

    const publicJwk: JWK = {};

    for (const member of PUBLIC_JWK_MEMBERS) {
      if (jwk[member] !== undefined) {
        publicJwk[member] = jwk[member];
      }
    }

    return {
      alg,
      key,
      kid: typeof jwk.kid === "string" ? jwk.kid : undefined,
      publicJwk,
    };
  } catch (_error) {
    return null;
  }
}

/**
 * The JWS header every token this tool signs carries: the key's algorithm,
 * and its `kid` when it has one, so a platform holding our JWKS can pick the
 * key out without trying each.
 */
export function protectedHeaderFor(toolKey: LtiToolKey): {
  alg: string;
  kid?: string;
} {
  return toolKey.kid === undefined
    ? { alg: toolKey.alg }
    : { alg: toolKey.alg, kid: toolKey.kid };
}
