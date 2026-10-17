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
 * hash a lesson records for each hosted theory it froze. One function
 * so the two cannot disagree — a lesson's record of a hosted theory is checked
 * against that theory's later revisions by comparing exactly these strings.
 */
export function mm0TextHash(text: string): Promise<string> {
  return sha256Id(`mm0-v1\n${text}`);
}

/**
 * MM0 text without what only a reader of the file sees: its `--` comments and
 * the layout between lexemes. `--|` lines stay, whole, since they are
 * annotations the language and the engine read; math strings stay verbatim,
 * since a `--` inside one is not a comment. The lexing is MM0's file level,
 * as `@aufbau/syntax` reads it.
 */
export function mm0Meaning(text: string): string {
  const words: string[] = [];
  let word = "";
  let i = 0;

  const endWord = () => {
    if (word !== "") {
      words.push(word);
      word = "";
    }
  };

  while (i < text.length) {
    const ch = text[i] ?? "";

    if (ch === "-" && text[i + 1] === "-") {
      const lineEnd = text.indexOf("\n", i);
      const end = lineEnd === -1 ? text.length : lineEnd;

      endWord();
      // Ended by its newline, so an annotation cannot run into the next word.
      if (text[i + 2] === "|") {
        words.push(`--| ${text.slice(i + 3, end).trim()}\n`);
      }
      i = end;
    } else if (ch === "$") {
      const close = text.indexOf("$", i + 1);
      const end = close === -1 ? text.length : close + 1;

      endWord();
      words.push(text.slice(i, end));
      i = end;
    } else if (/\s/.test(ch)) {
      endWord();
      i += 1;
    } else {
      word += ch;
      i += 1;
    }
  }

  endWord();
  return words.join(" ");
}

/**
 * The hash a lesson records for a built-in theory it froze, once per isolate.
 * Of the file's {@link mm0Meaning}, not its text, so that rewording a comment
 * in a shipped theory does not call every lesson on it out of date; a hosted
 * theory keeps {@link mm0TextHash}, which is how its later revisions are found.
 *
 * The built-ins are in the module graph and cannot change while it runs, so
 * the compiler recording a lesson's origins and the outdated-theory check
 * comparing them hash each file once between them. Keyed by address, and for
 * built-ins only: a hosted theory's text is not the caller's to keep for the
 * isolate's life.
 */
const builtInHashes = new Map<string, Promise<string>>();

export function builtInTheoryHash(
  src: string,
  text: string,
): Promise<string> {
  let hash = builtInHashes.get(src);

  if (hash === undefined) {
    hash = sha256Id(`mm0-meaning-v1\n${mm0Meaning(text)}`);
    builtInHashes.set(src, hash);
  }

  return hash;
}
