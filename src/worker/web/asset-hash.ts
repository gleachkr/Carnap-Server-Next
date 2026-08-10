/**
 * cyrb53 — a published non-cryptographic 53-bit string hash, not one invented
 * here — used to name the stylesheets and scripts we serve as their own files.
 *
 * Nothing here is a security boundary: the hash only has to change when the
 * text does, and to be cheap enough to run at module load on every isolate.
 * Deriving it from the string rather than from a build step is the point — the
 * URL cannot go stale, and there is no manifest to regenerate.
 *
 * A real digest would be the obvious reach, and it is the wrong one twice over.
 * `node:crypto` is the only synchronous option, and it needs the `nodejs_compat`
 * flag the worker does not set — without it the worker will not boot ("No such
 * module node:crypto"). This module is also bundled into the browser preview,
 * where the same import costs half a megabyte of polyfilled SHA-256. Web
 * Crypto's `subtle.digest` avoids both and is async, which a URL computed at
 * module load cannot be.
 *
 * Shared by {@link ./style-assets} and {@link ./script-assets} rather than
 * spelled twice, so the two families of asset URL cannot drift apart.
 */
export function hashAssetText(text: string): string {
  let low = 0xdeadbeef;
  let high = 0x41c6ce57;

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    low = Math.imul(low ^ code, 2654435761);
    high = Math.imul(high ^ code, 1597334677);
  }

  low =
    Math.imul(low ^ (low >>> 16), 2246822507) ^
    Math.imul(high ^ (high >>> 13), 3266489909);
  high =
    Math.imul(high ^ (high >>> 16), 2246822507) ^
    Math.imul(low ^ (low >>> 13), 3266489909);

  return (4294967296 * (2097151 & high) + (low >>> 0)).toString(36);
}
