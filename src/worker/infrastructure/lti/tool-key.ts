import { importJWK, type JWK } from "jose";

/** The tool's private signing key, imported and ready to sign with. */
export interface LtiToolKey {
  readonly alg: string;
  readonly kid: string | undefined;
  readonly key: CryptoKey;
}

/**
 * Parse `LTI_TOOL_PRIVATE_KEY` (a JSON JWK) into a signing key. Returns null
 * for anything unusable — unset, unparseable, symmetric, or malformed — so
 * callers can report "tool key not configured" instead of crashing.
 */
export async function loadLtiToolKey(
  raw: string | undefined,
): Promise<LtiToolKey | null> {
  if (raw === undefined || raw.trim().length === 0) {
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

  if (typeof jwk.kty !== "string" || jwk.kty === "oct") {
    return null;
  }

  const alg = typeof jwk.alg === "string" ? jwk.alg : "RS256";

  try {
    const key = await importJWK(jwk, alg);

    if (key instanceof Uint8Array) {
      return null;
    }

    return {
      alg,
      key,
      kid: typeof jwk.kid === "string" ? jwk.kid : undefined,
    };
  } catch (_error) {
    return null;
  }
}
