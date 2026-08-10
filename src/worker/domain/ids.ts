export type AppId = string;

const UUID_V7_RANDOM_BYTE_COUNT = 10;

function hex(bytes: Uint8Array): string {
  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function createAppId(now = Date.now()): AppId {
  const timestampHex = now.toString(16).padStart(12, "0").slice(-12);
  const randomBytes = new Uint8Array(UUID_V7_RANDOM_BYTE_COUNT);

  crypto.getRandomValues(randomBytes);

  const randomHex = hex(randomBytes);
  const variantNibble = (
    (Number.parseInt(randomHex[3] ?? "0", 16) & 0x3) |
    0x8
  ).toString(16);

  return [
    timestampHex.slice(0, 8),
    timestampHex.slice(8, 12),
    `7${randomHex.slice(0, 3)}`,
    `${variantNibble}${randomHex.slice(4, 7)}`,
    randomHex.slice(7, 19),
  ].join("-");
}
