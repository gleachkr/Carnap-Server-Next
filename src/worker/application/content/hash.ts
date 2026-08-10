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
