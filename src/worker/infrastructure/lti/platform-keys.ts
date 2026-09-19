import { createRemoteJWKSet, type JWTVerifyGetKey } from "jose";

import type { LtiPlatformKeyResolver } from "../../application/lti";
import { OUTBOUND_USER_AGENT } from "../../user-agent";

/**
 * One remote key set per JWKS URL for the isolate's lifetime. jose caches
 * the fetched keys inside the set (and refetches on an unknown `kid`), so
 * sharing the set is what makes a launch after the first not hit the LMS.
 */
const remoteKeySets = new Map<string, JWTVerifyGetKey>();

/**
 * The production `LtiPlatformKeyResolver`: the platform's published JWKS,
 * fetched over the network.
 *
 * The `User-Agent` is ours rather than the `jose/x.y.z` the library would
 * otherwise send: a platform admin reading their logs should see the tool that
 * is calling, not the JWT library it happens to be built on. Canvas rejects an
 * agentless request outright, so this header is load-bearing either way — jose
 * setting one of its own is the only reason launches were not already failing.
 */
export const remoteLtiKeyResolver: LtiPlatformKeyResolver = (platform) => {
  const cached = remoteKeySets.get(platform.jwksUri);

  if (cached !== undefined) {
    return cached;
  }

  const keySet = createRemoteJWKSet(new URL(platform.jwksUri), {
    headers: { "User-Agent": OUTBOUND_USER_AGENT },
  });

  remoteKeySets.set(platform.jwksUri, keySet);

  return keySet;
};
