const HASH_ALGORITHM = "SHA-256";

function hex(bytes: Uint8Array): string {
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function stableValue(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableValue).join(",")}]`;
  }

  const object = value as Record<string, unknown>;
  const entries = Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableValue(object[key])}`);

  return `{${entries.join(",")}}`;
}

export function stableJson(value: unknown): string {
  return stableValue(value);
}

export async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest(HASH_ALGORITHM, encoded);

  return hex(new Uint8Array(digest));
}

export async function sha256Id(value: string): Promise<string> {
  return `sha256:${await sha256Hex(value)}`;
}

/**
 * The hash of a piece of MM0 text: an MM0 revision's `contentHash`, and the
 * hash a lesson records for each theory it froze from an address. One function
 * so the two cannot disagree — a lesson's record of a hosted theory is checked
 * against that theory's later revisions by comparing exactly these strings.
 */
export function mm0TextHash(text: string): Promise<string> {
  return sha256Id(`mm0-v1\n${text}`);
}

/**
 * A built-in theory's {@link mm0TextHash}, once per isolate. The built-ins are
 * in the module graph and cannot change while it runs, so the compiler
 * recording a lesson's origins and the outdated-theory check comparing them
 * hash each file once between them. Keyed by address, and for built-ins only:
 * a hosted theory's text is not the caller's to keep for the isolate's life.
 */
const builtInHashes = new Map<string, Promise<string>>();

export function builtInTheoryHash(
  src: string,
  text: string,
): Promise<string> {
  let hash = builtInHashes.get(src);

  if (hash === undefined) {
    hash = mm0TextHash(text);
    builtInHashes.set(src, hash);
  }

  return hash;
}
