import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { rootBlocks, stripComments } from "./palette";

/**
 * The token layer's integrity, as facts about `var()`.
 *
 * Two kinds of token reach a stylesheet. The palette (`web/content.css`,
 * `--ink`, `--surface`, …) is read by the page's own rules, and a
 * `var(--token, <fallback>)` there must repeat the light value, because a
 * fallback that has drifted pins the value it was copied from — always a light
 * one — and shows up only under dark. The exercise tokens (`--exercise-*`) are
 * what the widgets read instead: the kit declares each one's default exactly
 * once, in `exercise-kit/tokens.css`, reading it into a private `--_` twin, and
 * `web/content.css` maps every one onto the palette. A widget rule reads the
 * twin and nothing else — no palette token, no fallback of its own — so that
 * the mapping is the whole of the contract between the page and a shadow
 * root, and an author's `:::style` has one set of names to write against.
 *
 * Each rule below fails at the moment two sides disagree rather than at the
 * moment somebody looks at the page in the dark, or with a stylesheet of their
 * own. Found on the palette test's introduction: three tokens used and never
 * defined and twenty-six fallbacks disagreeing with their token, most of them
 * a `--green` left at the pre-AA `#26935d`.
 */

const SOURCE_ROOT = join(import.meta.dir, "..", "..", "src");

/** The light palette, as `name -> value`. Values may wrap across lines. */
function paletteTokens(): Map<string, string> {
  const block = rootBlocks().get("light") as string;
  const tokens = new Map<string, string>();

  for (const match of block.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/gs)) {
    tokens.set(
      match[1] as string,
      (match[2] as string).split(/\s+/).join(" "),
    );
  }

  return tokens;
}

interface VarUse {
  readonly fallback: string | undefined;
  readonly line: number;
  readonly name: string;
}

/**
 * Every `var(...)` in a file. Scanned with a paren counter rather than matched
 * with a regex, because a fallback can itself be a `color-mix(...)` call and
 * `[^)]+` would stop inside it.
 */
function varUses(text: string): VarUse[] {
  const uses: VarUse[] = [];

  for (const match of text.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
    let index = match.index + match[0].length;
    let depth = 1;

    while (index < text.length && depth > 0) {
      if (text[index] === "(") {
        depth += 1;
      } else if (text[index] === ")") {
        depth -= 1;

        if (depth === 0) {
          break;
        }
      }

      index += 1;
    }

    const inner = text.slice(match.index + match[0].length, index).trim();

    uses.push({
      fallback: inner.startsWith(",")
        ? inner.slice(1).trim().split(/\s+/).join(" ")
        : undefined,
      line: text.slice(0, match.index).split("\n").length,
      name: match[1] as string,
    });
  }

  return uses;
}

/** `#abc` and `#AABBCC` are the same colour; compare them as one. */
function normalize(value: string): string {
  const lower = value.trim().toLowerCase();

  return /^#[0-9a-f]{3}$/.test(lower)
    ? `#${[...lower.slice(1)].map((digit) => digit + digit).join("")}`
    : lower;
}

function sourceFiles(directory: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...sourceFiles(path));
    } else if (/\.(?:tsx?|css)$/.test(entry.name)) {
      found.push(path);
    }
  }

  return found.sort();
}

const TOKENS = paletteTokens();
const FILES = sourceFiles(SOURCE_ROOT);
const SOURCES = new Map(
  FILES.map((file) => [
    file,
    stripComments(readFileSync(file, "utf8"), !file.endsWith(".css")),
  ]),
);

/**
 * Custom properties a script sets on an element at runtime — the split
 * view's rail position is one. They are not palette tokens and the palette
 * does not declare them, but a `var()` reading one is not reading nothing.
 */
const SCRIPT_PROPERTIES = new Set(
  [...SOURCES.values()].flatMap((text) =>
    [...text.matchAll(/setProperty\(["'`](--[a-z0-9-]+)["'`]/g)].map(
      (match) => match[1] as string,
    ),
  ),
);

const KIT = join(SOURCE_ROOT, "worker", "exercise-kit");
const TOKENS_CSS = join(KIT, "tokens.css");

/**
 * The kit's `:host` block, as `--_twin -> the --exercise-* token it reads`.
 * Each twin is declared once, as `var(--exercise-<name>, <default>)`, and a
 * twin whose declaration is any other shape is reported rather than read.
 */
function kitTwins(): Map<string, string> {
  const text = SOURCES.get(TOKENS_CSS) as string;
  const twins = new Map<string, string>();

  for (const match of text.matchAll(
    /(--_[a-z0-9-]+):\s*var\(\s*(--exercise-[a-z0-9-]+)\s*,/g,
  )) {
    const twin = match[1] as string;

    if (twins.has(twin)) {
      throw new Error(`${twin} is declared twice in tokens.css`);
    }

    twins.set(twin, match[2] as string);
  }

  return twins;
}

const TWINS = kitTwins();
const EXERCISE_TOKENS = new Set(TWINS.values());

/**
 * The stylesheets a widget serves into its shadow root: the eight kinds'
 * server-rendered chrome, the three review sheets, and the client-side
 * sheets each proof widget appends on hydration (the help dialog and the
 * goal row among them). The Fitch widget also spells one colour in a
 * script, for the scope lines it paints as a background image.
 */
const SHADOW_SHEETS = FILES.filter(
  (file) =>
    /\/exercises\/[a-z-]+\/(?:shadow|review)\.css$/.test(file) ||
    /\/client\/components\/[a-z0-9-]+\.css$/.test(file) ||
    file.endsWith("/client/components/carnap-aufbau-proof-fitch-v1.ts"),
);

/** The kit's own sheets, served into the light DOM and (group.css) both. */
const KIT_SHEETS = [join(KIT, "exercise.css"), join(KIT, "group.css")];

function relative(file: string): string {
  return file.slice(SOURCE_ROOT.length + 1);
}

test("the palette defines every token the source asks for", () => {
  const missing: string[] = [];

  for (const [file, text] of SOURCES) {
    for (const use of varUses(text)) {
      if (
        !TOKENS.has(use.name) &&
        !TWINS.has(use.name) &&
        !SCRIPT_PROPERTIES.has(use.name)
      ) {
        missing.push(`${relative(file)}:${use.line}: ${use.name}`);
      }
    }
  }

  expect(missing).toEqual([]);
});

test("every var() fallback on a palette token repeats its light value", () => {
  const drifted: string[] = [];

  for (const [file, text] of SOURCES) {
    // The kit's defaults are fallbacks by design and are not copies of
    // anything; the twins have no fallbacks at all.
    if (file === TOKENS_CSS) {
      continue;
    }

    for (const use of varUses(text)) {
      const value = TOKENS.get(use.name);

      if (
        use.fallback !== undefined &&
        value !== undefined &&
        !use.name.startsWith("--exercise-") &&
        normalize(use.fallback) !== normalize(value)
      ) {
        drifted.push(
          `${relative(file)}:${use.line}: ${use.name}` +
            ` is ${value}, fallback says ${use.fallback}`,
        );
      }
    }
  }

  expect(drifted).toEqual([]);
});

test("the kit declares a default for every exercise token, and the page maps every one", () => {
  // The two sides of the contract, compared as sets: a token the kit reads
  // that the page never maps falls to its default on every page, and a token
  // the page maps that the kit never reads styles nothing.
  const mapped = [...TOKENS.keys()].filter((name) =>
    name.startsWith("--exercise-"),
  );

  expect(mapped.sort()).toEqual([...EXERCISE_TOKENS].sort());

  // Each twin is named for its token: `--_field-bg` reads
  // `--exercise-field-bg`. Anything else is a twin reading the wrong token.
  const misnamed = [...TWINS].filter(
    ([twin, token]) => `--exercise-${twin.slice(3)}` !== token,
  );

  expect(misnamed).toEqual([]);
});

test("a widget stylesheet reads only the private twins", () => {
  // No palette token (the mapping is the contract), no `--exercise-*`
  // directly (the twin carries the default), and no fallback of its own (the
  // default is declared once, in tokens.css).
  const offenders: string[] = [];

  // Eight kinds' shadow sheets, three review sheets, the client sheets: a
  // scan that finds fewer is looking in the wrong place.
  expect(SHADOW_SHEETS.length).toBeGreaterThanOrEqual(17);
  expect(TWINS.size).toBeGreaterThanOrEqual(20);

  for (const file of SHADOW_SHEETS) {
    for (const use of varUses(SOURCES.get(file) as string)) {
      if (!TWINS.has(use.name) || use.fallback !== undefined) {
        offenders.push(`${relative(file)}:${use.line}: ${use.name}`);
      }
    }
  }

  expect(offenders).toEqual([]);
});

test("the kit's own chrome reads only the exercise tokens", () => {
  // The light-DOM chrome is served with the mapping and needs no default, so
  // it reads the `--exercise-*` tokens directly. group.css is served both
  // ways and reads each colour as `var(--_twin, var(--exercise-token))`: the
  // twin in a shadow root, the token on the page.
  const offenders: string[] = [];

  for (const file of KIT_SHEETS) {
    for (const use of varUses(SOURCES.get(file) as string)) {
      const viaTwin =
        TWINS.has(use.name) &&
        use.fallback === `var(${TWINS.get(use.name) as string})`;

      if (!EXERCISE_TOKENS.has(use.name) && !viaTwin) {
        offenders.push(`${relative(file)}:${use.line}: ${use.name}`);
      }
    }
  }

  expect(offenders).toEqual([]);
});

test("every review widget serves the kit's defaults into its root", () => {
  // The interactive kinds get the block with the group styles
  // (`EXERCISE_GROUP_SHADOW_STYLES`); a review widget composes its own root
  // and has to add it by name.
  const offenders: string[] = [];

  for (const [file, text] of SOURCES) {
    if (
      /\/exercises\/[a-z-]+\/read-only-view\.ts$/.test(file) &&
      text.includes('"./review.css"') &&
      !/REVIEW_STYLES = \[\s*EXERCISE_TOKEN_STYLES,/.test(text)
    ) {
      offenders.push(relative(file));
    }
  }

  expect(offenders).toEqual([]);
});
