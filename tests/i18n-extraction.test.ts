import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { messages as enMessages } from "../src/locales/en/messages";

/**
 * Every string literal handed to a `.t(…)` call under `src/` must be a key in
 * the English catalog.
 *
 * Nothing else in the system notices when one is not. `lingui extract` matches
 * the *receiver's name*, so `i18n.t("…")` is found and `context.get("i18n")
 * .t("…")` extracts nothing at all — no warning, no error. The runtime is just
 * as quiet by design: an id with no entry returns the id, which reads as clean
 * English and so looks correct to anyone testing in English. The string simply
 * never reaches a translator, and the page renders English in every locale.
 * That failure has no other detector; this test is it.
 *
 * The same assertion catches the neighbouring mistakes for free — a receiver
 * named `translator` or `t`, a destructured `const { t } = i18n`, and a literal
 * edited at the call site after the catalog was last written.
 */

const ROOT = resolve(import.meta.dir, "..");

const CATALOG_IDS = new Set(Object.keys(enMessages));

/**
 * A floor on how much this test actually inspected. The real count is in the
 * high 800s; a gate that silently stops matching is the exact failure mode
 * these checks have had before, and it looks identical to a passing run.
 */
const MINIMUM_CHECKED = 700;

interface TranslationCall {
  /** Repo-relative path, for a failure message someone can act on. */
  readonly file: string;
  /** Every string literal in the first argument. */
  readonly ids: readonly string[];
  readonly line: number;
  /** A template literal, which the extractor cannot read at all. */
  readonly templated: boolean;
}

async function sourceFiles(): Promise<string[]> {
  const paths: string[] = [];

  for await (const match of new Bun.Glob("src/**/*.{ts,tsx}").scan({
    cwd: ROOT,
  })) {
    paths.push(match);
  }

  return paths.sort();
}

/**
 * The source text of the first argument of the call whose `(` sits at `open`.
 *
 * A regex cannot do this: the argument may contain commas and parentheses of
 * its own inside a string, and stopping at the first `,` would let the
 * *values* object (`{ count: 1 }`) contribute literals that are not ids.
 */
function firstArgument(text: string, open: number): string | null {
  let depth = 0;
  let quote: string | null = null;

  for (let index = open; index < text.length; index += 1) {
    const char = text[index];

    if (quote !== null) {
      if (char === "\\") {
        index += 1;
      } else if (char === quote) {
        quote = null;
      }

      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
    } else if (char === "(" || char === "[" || char === "{") {
      depth += 1;
    } else if (char === ")" || char === "]" || char === "}") {
      depth -= 1;

      if (depth === 0) {
        return text.slice(open + 1, index);
      }
    } else if (char === "," && depth === 1) {
      return text.slice(open + 1, index);
    }
  }

  return null;
}

/** The written form of a string literal, escapes resolved. */
function decode(body: string, quote: '"' | "'"): string {
  // A double-quoted literal is already a JSON string; a single-quoted one
  // becomes one once `\'` is unescaped and any bare `"` is escaped.
  const json =
    quote === '"' ? body : body.replace(/\\'/g, "'").replace(/"/g, '\\"');

  try {
    return JSON.parse(`"${json}"`) as string;
  } catch {
    // An escape JSON does not share (`\x41`) is not worth a parser; the raw
    // body will simply fail the catalog lookup and name itself in the report.
    return body;
  }
}

/**
 * Every `.t(…)` call in one file, with the literals it passes.
 *
 * Matching `.t(` — with the dot — is what keeps the *declarations* out: the
 * `t(id, values, options)` methods in `src/worker/i18n/translator.ts` and
 * `src/client/components/base.ts` have no receiver, and a definition is not a
 * call site. Conversely a call whose first argument is not a literal at all
 * (`this.t(FITCH_DIAGNOSTIC_MESSAGES[problem.code])`) contributes no ids and
 * is silently skipped: the id is chosen at runtime, so no static check can
 * resolve it, and the string it resolves to is covered where it *is* written
 * literally.
 */
function callsIn(file: string, text: string): TranslationCall[] {
  const calls: TranslationCall[] = [];

  for (const match of text.matchAll(/\.t\(/g)) {
    const argument = firstArgument(text, match.index + 2);

    if (argument === null) {
      continue;
    }

    const ids: string[] = [];

    for (const literal of argument.matchAll(
      /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g,
    )) {
      ids.push(
        literal[1] === undefined
          ? decode(literal[2] ?? "", "'")
          : decode(literal[1], '"'),
      );
    }

    calls.push({
      file,
      ids,
      line: text.slice(0, match.index).split("\n").length,
      templated: argument.includes("`"),
    });
  }

  return calls;
}

const FILES = await sourceFiles();

const CALLS = (
  await Promise.all(
    FILES.map(async (file) =>
      callsIn(file, await Bun.file(`${ROOT}/${file}`).text()),
    ),
  )
).flat();

describe("translated strings reach the catalog", () => {
  test("every literal passed to .t() is an English catalog id", () => {
    const missing = CALLS.flatMap((call) =>
      call.ids
        .filter((id) => !CATALOG_IDS.has(id))
        .map((id) => `${call.file}:${call.line}  ${JSON.stringify(id)}`),
    );

    expect(
      missing,
      [
        "These strings are passed to .t() but are absent from",
        "src/locales/en/messages.po, so they render untranslated in every",
        "locale. Either the catalog is stale — run `bun run i18n` — or the",
        "call's receiver is not named `i18n`, which makes `lingui extract`",
        "skip it silently. Hoist the translator into a local spelled exactly",
        '`i18n` (`const i18n = context.get("i18n");`) and re-extract.',
      ].join(" "),
    ).toEqual([]);
  });

  test("no template literal is passed to .t()", () => {
    const templated = CALLS.filter((call) => call.templated).map(
      (call) => `${call.file}:${call.line}`,
    );

    expect(
      templated,
      [
        "A template literal cannot be extracted: `lingui extract` reads",
        "string literals only, so the interpolated text never enters the",
        "catalog. Write the id as a plain string with ICU placeholders and",
        "pass the values as the second argument:",
        't("{count} left", { count }).',
      ].join(" "),
    ).toEqual([]);
  });

  test("the scan actually inspected the call sites", () => {
    const checkedCount = CALLS.reduce(
      (total, call) => total + call.ids.length,
      0,
    );

    expect(checkedCount).toBeGreaterThan(MINIMUM_CHECKED);
  });
});
