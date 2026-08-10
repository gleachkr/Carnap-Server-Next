import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import linguiConfig from "../lingui.config";

/**
 * Catalog staleness and translation coverage, answered without writing to the
 * tree (see `docs/i18n.md`).
 *
 *   bun run i18n:check      → do the committed catalogs still match the source?
 *   bun run i18n:coverage   → which locales are missing translations?
 *
 * Both questions are read-only, and both used to be answered by running
 * `lingui extract`/`compile` straight over `src/locales/` and looking at what
 * changed. That cost three things: the check only meant anything on a clean
 * tree, it could not join `bun run validate` (which must not mutate), and
 * running it mid-edit silently rewrote the very catalogs it was auditing.
 *
 * So extract and compile into a temp directory instead, and compare. The temp
 * directory is *seeded* with the committed `.po` files, which matters twice
 * over: extraction merges into the catalog it finds, so without them every
 * translation would read as newly missing, and the PO header's
 * `POT-Creation-Date` is carried over from the file being replaced rather than
 * stamped fresh — an empty directory would report all three catalogs as changed
 * on a repo where nothing is wrong.
 *
 * `CARNAP_I18N_CATALOG_DIR` (see `lingui.config.ts`) is what moves the output.
 * Only the output moves: `rootDir` is still the repo, so the extraction scope
 * and the `#:` origin comments come out identical to a real `bun run i18n`.
 *
 * The staleness half is also a `bun test` gate — see
 * `tests/i18n-staleness.test.ts` — so `bun run validate` covers it. This script
 * is the version that explains itself when it fails.
 */

const ROOT = resolve(import.meta.dir, "..");
const LINGUI = join(ROOT, "node_modules", ".bin", "lingui");
const COMMITTED = join(ROOT, "src", "locales");

/** Per locale: the translator's file, and the generated one the Worker imports. */
const CATALOG_FILES = ["messages.po", "messages.ts"] as const;

/** How many added/removed messages to name before summarizing the rest. */
const SAMPLE_LIMIT = 12;

/** How much of a message id to show; they are whole sentences. */
const ID_WIDTH = 90;

export interface CatalogDiff {
  readonly locale: string;
  readonly name: string;
  /** `null` when the file is not committed yet. */
  readonly committed: string | null;
  /** `null` when this run did not produce the file at all. */
  readonly fresh: string | null;
}

export interface CheckResult {
  readonly diffs: readonly CatalogDiff[];
  /** Lingui's own output, kept for the failure path. */
  readonly output: string;
  readonly code: number;
}

/**
 * Every locale either side knows about. The config decides what lingui writes,
 * but a directory the config has stopped listing is an orphan worth reporting
 * rather than a file to quietly skip.
 */
function locales(): string[] {
  const configured = linguiConfig.locales ?? [];
  const onDisk = existsSync(COMMITTED)
    ? readdirSync(COMMITTED, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    : [];

  return [...new Set([...configured, ...onDisk])].sort();
}

function runLingui(
  args: readonly string[],
  catalogDir: string,
  quiet: boolean,
): { readonly code: number; readonly output: string } {
  const result = Bun.spawnSync({
    cmd: [LINGUI, ...args],
    cwd: ROOT,
    env: { ...process.env, CARNAP_I18N_CATALOG_DIR: catalogDir },
    stderr: quiet ? "pipe" : "inherit",
    stdout: quiet ? "pipe" : "inherit",
  });
  // Both are `undefined` when the streams were inherited, which is the case
  // where the caller wanted lingui to do the talking.
  const output = `${result.stdout?.toString() ?? ""}${result.stderr?.toString() ?? ""}`;

  return { code: result.exitCode, output };
}

/**
 * Copy the committed catalogs into `work`. A locale the config lists but nobody
 * has extracted yet has nothing to copy; the comparison then reports its whole
 * catalog as new, which is the truth.
 */
function seed(work: string, all: readonly string[]): void {
  for (const locale of all) {
    const po = join(COMMITTED, locale, "messages.po");

    mkdirSync(join(work, locale), { recursive: true });

    if (existsSync(po)) {
      cpSync(po, join(work, locale, "messages.po"));
    }
  }
}

function readIfPresent(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function catalogDiffs(work: string, all: readonly string[]): CatalogDiff[] {
  const diffs: CatalogDiff[] = [];

  for (const locale of all) {
    for (const name of CATALOG_FILES) {
      const committed = readIfPresent(join(COMMITTED, locale, name));
      const fresh = readIfPresent(join(work, locale, name));

      if (committed !== fresh) {
        diffs.push({ committed, fresh, locale, name });
      }
    }
  }

  return diffs;
}

/**
 * The message ids a PO holds. Not a parser: an id wrapped across lines comes
 * back as its first segment only. That still names the entry, which is all a
 * summary needs — the fix is `bun run i18n` either way.
 */
function messageIds(po: string): Set<string> {
  const ids = new Set<string>();
  const prefix = 'msgid "';

  for (const line of po.split("\n")) {
    // `msgid ""` is the PO header, not a message.
    if (line.startsWith(prefix) && line.length > prefix.length + 1) {
      ids.add(line.slice(prefix.length, -1));
    }
  }

  return ids;
}

function truncate(id: string): string {
  return id.length > ID_WIDTH ? `${id.slice(0, ID_WIDTH - 1)}…` : id;
}

function printSample(mark: string, ids: readonly string[]): void {
  for (const id of ids.slice(0, SAMPLE_LIMIT)) {
    console.log(`    ${mark} ${truncate(id)}`);
  }

  if (ids.length > SAMPLE_LIMIT) {
    console.log(`    ${mark} … and ${ids.length - SAMPLE_LIMIT} more`);
  }
}

function printDiff(diff: CatalogDiff): void {
  const { committed, fresh, locale, name } = diff;

  console.log(`■ src/locales/${locale}/${name}`);

  if (committed === null) {
    console.log("    not committed yet");
    return;
  }

  if (fresh === null) {
    console.log(
      "    committed but not written by this run — is the locale still listed in lingui.config.ts?",
    );
    return;
  }

  if (name !== "messages.po") {
    // True both when the .po changed and when only the generated file is
    // behind — a compile that was never re-run, or an edit made here by hand.
    console.log("    not what its .po compiles to");
    return;
  }

  const before = messageIds(committed);
  const after = messageIds(fresh);
  const added = [...after].filter((id) => !before.has(id)).sort();
  const removed = [...before].filter((id) => !after.has(id)).sort();

  if (added.length === 0 && removed.length === 0) {
    console.log(
      "    the same messages, but their translations, origins, or header changed",
    );
    return;
  }

  printSample("+", added);
  printSample("-", removed);
}

/** Extract and compile over a copy, then compare with what is committed. */
export function checkStaleness(work: string): CheckResult {
  const all = locales();

  seed(work, all);

  const extract = runLingui(["extract", "--clean"], work, true);

  if (extract.code !== 0) {
    return { code: extract.code, diffs: [], output: extract.output };
  }

  const compile = runLingui(["compile"], work, true);

  if (compile.code !== 0) {
    return { code: compile.code, diffs: [], output: compile.output };
  }

  const diffs = catalogDiffs(work, all);

  return {
    code: diffs.length === 0 ? 0 : 1,
    diffs,
    output: `${extract.output}${compile.output}`,
  };
}

function reportStaleness(result: CheckResult): void {
  if (result.diffs.length === 0 && result.code !== 0) {
    console.error(result.output);
    console.error("lingui failed; nothing was compared.");
    return;
  }

  if (result.diffs.length === 0) {
    const en = readIfPresent(join(COMMITTED, "en", "messages.po"));
    const count = en === null ? 0 : messageIds(en).size;

    console.log(
      `\nCatalogs match the source — ${count} message(s), ${locales().length} locale(s).\n`,
    );
    return;
  }

  console.log(`\nStale catalogs — ${result.diffs.length} file(s)\n`);

  for (const diff of result.diffs) {
    printDiff(diff);
  }

  console.log("\nRun `bun run i18n` and commit the result.\n");
}

/**
 * Translation coverage: `lingui compile --strict`, the same question this has
 * always asked, over a copy. Nothing is extracted first — coverage is a
 * property of the committed catalogs, not of the source.
 */
export function checkCoverage(work: string): number {
  const all = locales();

  seed(work, all);

  return runLingui(["compile", "--strict"], work, false).code;
}

if (import.meta.main) {
  const coverage = process.argv.includes("--coverage");
  const work = mkdtempSync(join(tmpdir(), "carnap-i18n-"));
  let code = 1;

  try {
    if (coverage) {
      code = checkCoverage(work);
    } else {
      const result = checkStaleness(work);

      reportStaleness(result);
      code = result.code;
    }
  } finally {
    rmSync(work, { force: true, recursive: true });
  }

  // After the cleanup, not inside it: `process.exit` does not run `finally`.
  process.exit(code);
}
