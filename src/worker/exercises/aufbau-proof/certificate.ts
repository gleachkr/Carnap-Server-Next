/**
 * The MMB certificate an answer envelope carries, read once for the five
 * exercise types that grade one: the four proof types and translation.
 *
 * The certificate is the graded input and nothing more. The worker verifies it
 * against the frozen theory in `evaluate`, records the verdict, and lets it go:
 * it is not part of the answer that is stored. A stored answer keeps what the
 * certificate was compiled from — the `.auf`, the Fitch source, the tree, the
 * translation — which is enough to compile it again should a verdict ever be
 * questioned, at a tenth of the size. See [[aufbau-engine-packages]].
 */

/** Generous cap so an intro proof passes but a submission can't be unbounded. */
export const MAX_CERTIFICATE_BASE64_LENGTH = 262_144;

/**
 * Decode the base64 `mmb` field of an envelope's data. `undefined` when the
 * envelope carries none, `null` when it carries one that is over the cap or is
 * not base64. The proof types treat both as malformed; translation accepts the
 * first (an answer typed but never checked) and refuses only the second.
 */
export function readCertificate(data: object): Uint8Array | null | undefined {
  const value = (data as { readonly mmb?: unknown }).mmb;

  if (value === undefined) {
    return undefined;
  }

  if (
    typeof value !== "string" ||
    value.length > MAX_CERTIFICATE_BASE64_LENGTH
  ) {
    return null;
  }

  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}
