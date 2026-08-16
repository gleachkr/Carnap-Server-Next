/**
 * The one way this codebase mints and stores a secret.
 *
 * Session cookies, CSRF cookies, login links, LTI state and nonces, enrollment
 * links, and the login throttle's bucket keys all pass through here, so the
 * rules hold everywhere at once: 32 random bytes from the platform CSPRNG, a
 * prefix naming the family, and never the token itself in the database — only
 * its SHA-256, so a database that leaks does not hand over live credentials.
 *
 * Kept apart from `auth.ts` because that module is the service, and hashing a
 * value is not the service's business: the login rate limiter needs the same
 * digest and has no reason to depend on `AuthService`.
 */

const TOKEN_BYTE_COUNT = 32;

function base64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";

  for (const byte of view) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function createAuthToken(prefix: string): string {
  const bytes = new Uint8Array(TOKEN_BYTE_COUNT);

  crypto.getRandomValues(bytes);

  return `${prefix}_${base64Url(bytes)}`;
}

export async function hashAuthToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);

  return base64Url(digest);
}
