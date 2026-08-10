import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";

import { messages as deMessages } from "../src/locales/de/messages";

/**
 * The browser bundles must carry no i18n runtime and no message catalog.
 *
 * This is easy to break by accident and expensive when broken. The authoring
 * preview (`src/client/editor-preview.ts`) imports the Worker's content
 * renderer, markdown compiler, and content-document builder, so those modules
 * and everything they reach compile into a browser bundle. A single
 * `import { i18nFor } from "../worker/i18n"` anywhere in that graph would
 * pull `@lingui/core` plus every locale's catalog across the wire. The rule
 * that prevents it: those modules take an `i18n: Translator` parameter and
 * never import the i18n module.
 *
 * Two layers, because each one alone has a hole:
 *
 *  1. A module-graph walk from the client entry points. It needs no build
 *     artifact, so it works on a fresh clone, and no minifier can defeat it:
 *     the import edge either exists or it does not.
 *  2. A scan of the built bundles, which catches anything the walk's own
 *     resolver misses. An unbuilt tree fails this layer rather than skipping
 *     it — a guard that quietly checks nothing is worse than no guard.
 */

const ROOT = resolve(import.meta.dir, "..");

/** Modules that must never be reachable from browser code. */
function isForbiddenModule(path: string): boolean {
  const rel = relative(ROOT, path);

  // `src/worker/i18n/locales.ts` and `translator.ts` are deliberately
  // reachable: they are leaves that touch no catalog. Only the barrel that
  // constructs `I18n` instances is off limits.
  return rel === "src/worker/i18n/index.ts" || rel.startsWith("src/locales/");
}

/** Bare specifiers that must never be reachable from browser code. */
function isForbiddenPackage(specifier: string): boolean {
  return specifier === "@lingui" || specifier.startsWith("@lingui/");
}

/**
 * The client entry points, read out of `build:client` rather than duplicated
 * here, so a newly added component is guarded the day it is added.
 */
async function clientEntryPoints(): Promise<string[]> {
  const pkg = (await Bun.file(`${ROOT}/package.json`).json()) as {
    readonly scripts: Readonly<Record<string, string>>;
  };
  const script = pkg.scripts["build:client"] ?? "";
  const entries: string[] = [];

  for (const command of script.split("&&")) {
    const tokens = command.trim().split(/\s+/);

    if (tokens[0] !== "bun" || tokens[1] !== "build") {
      continue;
    }

    // Positional arguments up to the first flag are the entry points; they
    // may be globs (`aufbau-*.ts`).
    for (const token of tokens.slice(2)) {
      if (token.startsWith("-")) {
        break;
      }

      for await (const match of new Bun.Glob(token).scan({ cwd: ROOT })) {
        entries.push(resolve(ROOT, match));
      }
    }
  }

  return entries;
}

/** Extension guesses, in the order a bundler would try them. */
const RESOLUTION_SUFFIXES = [
  "",
  ".ts",
  ".tsx",
  ".mjs",
  ".js",
  ".jsx",
  "/index.ts",
  "/index.tsx",
  "/index.js",
];

async function resolveRelative(
  specifier: string,
  importer: string,
): Promise<string | null> {
  const base = resolve(dirname(importer), specifier);
  const candidates = RESOLUTION_SUFFIXES.map((suffix) => base + suffix);

  // A `./foo.js` specifier in TypeScript source means `./foo.ts`.
  if (base.endsWith(".js")) {
    candidates.push(
      base.replace(/\.js$/, ".ts"),
      base.replace(/\.js$/, ".tsx"),
    );
  }

  for (const candidate of candidates) {
    const stat = await Bun.file(candidate)
      .stat()
      .catch(() => null);

    if (stat?.isFile() === true) {
      return candidate;
    }
  }

  return null;
}

const TRANSPILERS = {
  ts: new Bun.Transpiler({ loader: "ts" }),
  tsx: new Bun.Transpiler({ loader: "tsx" }),
};

interface WalkResult {
  /** Every module reachable from an entry point. */
  readonly reached: ReadonlySet<string>;
  /** Human-readable import chains that end at something forbidden. */
  readonly violations: readonly string[];
  /** Relative specifiers this resolver could not follow. */
  readonly unresolved: readonly string[];
}

async function walkClientGraph(): Promise<WalkResult> {
  const entries = await clientEntryPoints();
  const importedBy = new Map<string, string>();
  const reached = new Set<string>();
  const violations: string[] = [];
  const unresolved: string[] = [];
  const queue = [...entries];

  const chain = (file: string): string => {
    const steps = [relative(ROOT, file)];
    let current = importedBy.get(file);

    while (current !== undefined) {
      steps.unshift(relative(ROOT, current));
      current = importedBy.get(current);
    }

    return steps.join(" → ");
  };

  while (queue.length > 0) {
    const file = queue.shift() as string;

    if (reached.has(file)) {
      continue;
    }

    reached.add(file);

    if (isForbiddenModule(file)) {
      violations.push(chain(file));
      continue;
    }

    const source = await Bun.file(file).text();
    const transpiler = /\.[jt]sx$/.test(file)
      ? TRANSPILERS.tsx
      : TRANSPILERS.ts;

    // `scanImports` reports what survives type-stripping, so `import type`
    // edges — which no bundler emits — are correctly ignored.
    for (const { path } of transpiler.scanImports(source)) {
      if (!path.startsWith(".")) {
        if (isForbiddenPackage(path)) {
          violations.push(`${chain(file)} → ${path}`);
        }

        continue;
      }

      const target = await resolveRelative(path, file);

      if (target === null) {
        unresolved.push(`${relative(ROOT, file)} → ${path}`);
        continue;
      }

      if (!reached.has(target)) {
        importedBy.set(target, file);
        queue.push(target);
      }
    }
  }

  return { reached, unresolved, violations };
}

const BUNDLE_DIRS = ["public/assets", "public/assets/components"];

async function jsBundles(): Promise<string[]> {
  const found: string[] = [];

  for (const dir of BUNDLE_DIRS) {
    let entries: string[];

    try {
      entries = await readdir(resolve(ROOT, dir));
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.endsWith(".js")) {
        found.push(`${dir}/${entry}`);
      }
    }
  }

  return found;
}

/**
 * An internal literal of `@lingui/core`'s message formatter. Measured to
 * survive `bun build --minify`, unlike the package specifier (resolved away)
 * and the `setupI18n` identifier (renamed) — so it catches a runtime-only
 * leak, which carries no catalog prose to recognise.
 */
const LINGUI_RUNTIME_MARKER = "__lingui_octothorpe__";

function catalogStrings(value: unknown, into: string[]): void {
  if (typeof value === "string") {
    into.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) {
      catalogStrings(item, into);
    }
  }
}

/**
 * Prose lifted from the compiled `de` catalog, to catch a catalog that got
 * bundled even with the runtime tree-shaken away.
 *
 * Derived at run time rather than hardcoded: a translator rewording a message
 * would silently disarm a literal marker. Candidates are filtered to plain
 * ASCII (a minifier may escape non-ASCII, and then the literal would not
 * match) and to translations that differ from their own message id, so an
 * as-yet-untranslated entry cannot collide with English text a component
 * legitimately hardcodes.
 */
function catalogMarkers(): string[] {
  const candidates: string[] = [];

  for (const [id, value] of Object.entries(
    deMessages as Record<string, unknown>,
  )) {
    const chunks: string[] = [];

    catalogStrings(value, chunks);

    for (const chunk of chunks) {
      if (
        chunk.length >= 24 &&
        /^[ -~]+$/.test(chunk) &&
        !/["\\`]/.test(chunk) &&
        !id.includes(chunk)
      ) {
        candidates.push(chunk);
      }
    }
  }

  return candidates
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .slice(0, 5);
}

describe("client module graph", () => {
  test("reaches no i18n runtime and no message catalog", async () => {
    const { reached, unresolved, violations } = await walkClientGraph();

    // A resolver that silently drops edges would make this test vacuous.
    expect(unresolved).toEqual([]);
    // Cheap proof the walk ran: the preview alone pulls in dozens of modules.
    expect(reached.size).toBeGreaterThan(10);
    expect(violations).toEqual([]);
  });
});

describe("client bundles", () => {
  test("carry no i18n runtime and no message catalog", async () => {
    const bundles = await jsBundles();

    if (bundles.length === 0) {
      throw new Error(
        "No built client bundles under public/assets; " +
          "run `bun run build:client` (as `bun run validate` does).",
      );
    }

    const markers = [LINGUI_RUNTIME_MARKER, ...catalogMarkers()];

    // If the catalog stopped yielding usable prose this layer would quietly
    // shrink to the runtime marker alone.
    expect(markers.length).toBeGreaterThan(1);

    const offenders: string[] = [];

    for (const path of bundles) {
      const source = await Bun.file(resolve(ROOT, path)).text();

      for (const marker of markers) {
        if (source.includes(marker)) {
          offenders.push(`${path} contains "${marker}"`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
