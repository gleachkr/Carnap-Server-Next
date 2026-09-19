import { SignJWT } from "jose";

import { type LtiToolKey, protectedHeaderFor } from "./tool-key";

/** How long a signed Deep Linking response stays valid at the platform. */
const RESPONSE_TTL = "5m";

/**
 * Sign the claims `LtiService.prepareDeepLinkResponse` built into the JWT the
 * platform's return form posts back. The claims are the application's; the
 * key and the JWS shape are this layer's, as they are for the AGS client's
 * assertion — the application never sees the key.
 */
export async function signDeepLinkResponse(
  toolKey: LtiToolKey,
  claims: Record<string, unknown>,
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader(protectedHeaderFor(toolKey))
    .setIssuedAt()
    .setExpirationTime(RESPONSE_TTL)
    .sign(toolKey.key);
}
