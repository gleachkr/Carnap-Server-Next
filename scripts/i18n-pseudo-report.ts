import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { collectFixtures } from "../tests/a11y/fixtures";
import { visibleText } from "../tests/i18n/visible-text";

/**
 * Translation-coverage inventory (advisory, ratcheted).
 *
 *   bun run i18n:report      → print the English still visible under the
 *                              pseudolocale, per page, vs. the baseline
 *   bun run i18n:baseline    → same, then re-record the baseline
 *
 * Under `Accept-Language: en-XA` every message that goes through `i18n` comes
 * back accented, so anything left in plain ASCII letters is either not wrapped
 * yet or legitimately not translatable. This is the burn-down list for the
 * per-file sweep: a shrinking count is progress.
 *
 * Ratcheted: the exit code is nonzero when some page's residue grows past
 * the baseline, and zero when it shrinks (with a nudge to re-record). The
 * absolute numbers are never the gate — only the direction of travel is —
 * because telling "unwrapped prose" from "a course title, a logic formula, an
 * id, a proper noun" needs an allowlist, and an allowlist maintained forever
 * rots into noise. The hard gate is `tests/i18n-pseudo.test.ts`, which asks a
 * question with no false positives: does a *known catalog message* still
 * render as English?
 */

const PSEUDO_LOCALE = "en-XA";

export const BASELINE_PATH = join(
  import.meta.dir,
  "..",
  "tests",
  "i18n",
  "pseudo-baseline.json",
);

/** Shortest run of ASCII letters worth reporting; below this it is noise. */
const MIN_TOKEN_LENGTH = 4;

/**
 * Words that are ASCII and always will be: the product name, fixture data the
 * harness itself seeds, domain notation, and acronyms that are not translated.
 * Kept small on purpose — this list existing at all is why the report is
 * advisory rather than a gate.
 */
const ALLOWED = new Set(
  [
    // Product and brand. "Aufbau" is the proof engine, which several exercise
    // types are named after; "Carnap" is the platform itself.
    "Aufbau",
    "Carnap",
    // Acronyms and formats that stay as-is in every language.
    "CSV",
    "JSON",
    "LMS",
    "LTI",
    // Fixture-seeded content (see tests/a11y/fixtures.ts): course, lesson,
    // assignment, and account names, plus the lesson's own prose.
    "Accessibility",
    "Choose",
    "Homework",
    "Intro",
    "Logic",
    "Practice",
    "Prove",
    "Submission",
    "example",
    "flowing",
    "fixture",
    "instructor",
    "lesson",
    "paragraph",
    "prose",
    "short",
    "student",
    "tautology",
    "test",
    "newcomer",
    "content",
    "true",
    "wff",
    // mm0 / .auf notation appearing in the fixture theory and proofs.
    "axiom",
    "provable",
    "sort",
    "term",
    "theorem",
    "top_i",
    "thm_top",
    "thm_tree",
    "Build",
  ].map((word) => word.toLowerCase()),
);

/**
 * Every word appearing in an IANA timezone identifier. The course forms render
 * a `<select>` of all ~450 of them, which would otherwise dominate this report
 * with several hundred place names on two pages. They are data, not interface
 * text: a timezone identifier is the same string in every language.
 *
 * Derived from the runtime rather than hard-coded, so it tracks the tz database
 * as it changes.
 */
const TIMEZONE_WORDS = new Set(
  (
    (Intl as { supportedValuesOf?: (key: "timeZone") => string[] })
      .supportedValuesOf?.("timeZone") ?? []
  ).flatMap((zone) =>
    zone.split(/[^A-Za-z]+/).map((word) => word.toLowerCase()),
  ),
);

export interface PseudoBaseline {
  readonly note: string;
  /** Fixture name → the ASCII words still visible, sorted. */
  readonly residue: Readonly<Record<string, readonly string[]>>;
}

/** Words of interest, deduped and sorted, minus the allowlists. */
function asciiWords(candidates: readonly string[]): string[] {
  const words = new Set<string>();

  for (const word of candidates) {
    const lower = word.toLowerCase();

    if (
      word.length >= MIN_TOKEN_LENGTH &&
      !ALLOWED.has(lower) &&
      !TIMEZONE_WORDS.has(lower)
    ) {
      words.add(word);
    }
  }

  return [...words].sort((a, b) => a.localeCompare(b));
}

export async function collectResidue(): Promise<
  Record<string, readonly string[]>
> {
  const fixtures = await collectFixtures({
    headers: { "Accept-Language": PSEUDO_LOCALE },
  });
  const residue: Record<string, readonly string[]> = {};

  for (const fixture of fixtures) {
    residue[fixture.name] = asciiWords(visibleText(fixture.html).words);
  }

  return residue;
}

function loadBaseline(): PseudoBaseline | null {
  try {
    return require(BASELINE_PATH) as PseudoBaseline;
  } catch {
    return null;
  }
}

function totalWords(
  residue: Readonly<Record<string, readonly string[]>>,
): number {
  return Object.values(residue).reduce((sum, words) => sum + words.length, 0);
}

function printReport(
  residue: Readonly<Record<string, readonly string[]>>,
  baseline: PseudoBaseline | null,
): void {
  const total = totalWords(residue);
  const previous = baseline === null ? null : baseline.residue;
  const previousTotal = previous === null ? null : totalWords(previous);

  console.log(
    `\nTranslation coverage under ${PSEUDO_LOCALE} — ` +
      `${total} untranslated word(s) across ${Object.keys(residue).length} page(s)` +
      (previousTotal === null
        ? ""
        : `  (baseline ${previousTotal}, delta ${total - previousTotal >= 0 ? "+" : ""}${total - previousTotal})`) +
      "\n",
  );

  for (const name of Object.keys(residue).sort()) {
    const words = residue[name] ?? [];
    const before = previous?.[name] ?? null;
    const added =
      before === null
        ? []
        : words.filter((word) => !before.includes(word));
    const fixed =
      before === null
        ? []
        : before.filter((word) => !words.includes(word));

    console.log(`■ ${name}  (${words.length})`);

    if (added.length > 0) {
      console.log(`    + new: ${added.join(", ")}`);
    }

    if (fixed.length > 0) {
      console.log(`    - gone: ${fixed.join(", ")}`);
    }

    if (words.length > 0) {
      console.log(`      ${words.join(", ")}`);
    }
  }

  console.log("");
}

interface Regression {
  readonly after: number;
  readonly before: number;
  readonly name: string;
}

/**
 * Pages whose residue grew. A page missing from the baseline has no prior
 * measurement to have grown past, so it is reported by `printReport` as new
 * but does not fail: the ratchet only ever compares like with like.
 */
function regressions(
  residue: Readonly<Record<string, readonly string[]>>,
  baseline: PseudoBaseline,
): Regression[] {
  const found: Regression[] = [];

  for (const [name, words] of Object.entries(residue)) {
    const before = baseline.residue[name];

    if (before !== undefined && words.length > before.length) {
      found.push({ after: words.length, before: before.length, name });
    }
  }

  return found.sort((a, b) => a.name.localeCompare(b.name));
}

function toBaseline(
  residue: Readonly<Record<string, readonly string[]>>,
): PseudoBaseline {
  return {
    note:
      `English words still visible under the ${PSEUDO_LOCALE} pseudolocale, ` +
      "i.e. text not yet routed through i18n (minus an allowlist of the " +
      "product name, acronyms, fixture-seeded data, and logic notation). " +
      "Advisory, not a gate: regenerate with `bun run i18n:baseline`. A " +
      "shrinking list is progress; the hard gate is tests/i18n-pseudo.test.ts.",
    residue,
  };
}

if (import.meta.main) {
  const update = process.argv.includes("--update");
  const residue = await collectResidue();
  const baseline = loadBaseline();

  printReport(residue, baseline);

  if (update) {
    writeFileSync(
      BASELINE_PATH,
      `${JSON.stringify(toBaseline(residue), null, 2)}\n`,
    );
    console.log(`Wrote the coverage baseline to ${BASELINE_PATH}`);
  } else if (baseline !== null) {
    const grown = regressions(residue, baseline);

    for (const { after, before, name } of grown) {
      console.log(`✗ ${name}: ${before} → ${after} untranslated word(s)`);
    }

    if (grown.length > 0) {
      console.log(
        "\nCoverage went backwards. Wrap the new strings, or re-record the " +
          "baseline deliberately with `bun run i18n:baseline`.\n",
      );

      process.exit(1);
    }

    if (totalWords(residue) < totalWords(baseline.residue)) {
      console.log(
        "Coverage improved. Lock it in with `bun run i18n:baseline`.\n",
      );
    }
  }

  // The shared Miniflare instance keeps the event loop alive, so exit
  // explicitly rather than hang after the report is printed.
  process.exit(0);
}
