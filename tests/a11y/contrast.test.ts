import { expect, test } from "bun:test";

import { CONTENT_STYLES } from "../../src/worker/web/styles";

/**
 * The palette's contrast rules, as arithmetic rather than as prose.
 *
 * `docs/a11y.md` derives a three-tier ink scale against five named fills and
 * states the outcome in English: `--ink-muted` is legal on the cool surfaces,
 * warm fills want `--ink-muted-strong`, `--ink-faint` is decoration and may
 * never carry meaning. That was a fine record of one careful sitting, and it
 * had no way to notice when a token later moved — which is how the badge
 * borders came to be drawn in a `--green` the palette had already abandoned.
 *
 * It matters more now there are two palettes. None of the ratios survive the
 * translation to dark: they have to be re-derived, and re-derived again by
 * whoever next nudges a value. So the pairings the application actually draws
 * are asserted here, for every palette the stylesheet defines, in `bun test`
 * with no browser — which puts dark mode in `bun run validate` rather than
 * only in the on-demand Tier 2 run.
 *
 * This does not replace Tier 2. It checks the pairs we know the app draws;
 * axe in a real browser checks what the page *actually* renders, including
 * combinations nobody planned. See `docs/a11y.md`.
 */

const AA_TEXT = 4.5;
const AAA_TEXT = 7;

/** WCAG 2.x relative luminance. */
function luminance(hex: string): number {
  const channel = (offset: number): number => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;

    return value <= 0.03928
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(foreground: string, background: string): number {
  const first = luminance(foreground);
  const second = luminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);

  return (lighter + 0.05) / (darker + 0.05);
}

type Palette = ReadonlyMap<string, string>;

/**
 * The opaque colours of one `:root` block. Everything else in the block — the
 * fonts, the measures, and the derived `color-mix(...)` values — is skipped:
 * a ratio is only meaningful between two colours that actually cover.
 */
function colorsIn(block: string): Map<string, string> {
  const colors = new Map<string, string>();

  for (const match of block.matchAll(
    /(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g,
  )) {
    const hex = match[2] as string;

    if (hex.length === 4) {
      colors.set(
        match[1] as string,
        `#${[...hex.slice(1)].map((digit) => digit + digit).join("")}`,
      );
    } else if (hex.length === 7) {
      colors.set(match[1] as string, hex);
    }
  }

  return colors;
}

/**
 * Every palette the stylesheet defines: the base `:root`, plus one per
 * `@media` block that redeclares it. A media palette inherits every token it
 * does not override, which is what makes the dark block short — and is also
 * why it has to be resolved here before anything is measured.
 */
function palettes(): Map<string, Palette> {
  const found = new Map<string, Palette>();
  const base = /^ {2}:root \{(.*?)\n {2}\}/ms.exec(CONTENT_STYLES);

  if (base?.[1] === undefined) {
    throw new Error("no base :root block in CONTENT_STYLES");
  }

  const light = colorsIn(base[1]);
  found.set("light", light);

  for (const media of CONTENT_STYLES.matchAll(
    /@media \(([^)]+)\) \{\s*:root \{(.*?)\n {4}\}/gs,
  )) {
    found.set(
      media[1] as string,
      new Map([...light, ...colorsIn(media[2] as string)]),
    );
  }

  return found;
}

const PALETTES = palettes();

/** Where ordinary text sits. `--rule` is a divider, never a text background. */
const TEXT_SURFACES = ["--surface", "--control-surface"] as const;
const WARM_SURFACES = [
  "--paper",
  "--paper-top",
  "--surface-soft",
  "--rule-soft",
] as const;
const ACCENTS = [
  "--blue",
  "--blue-strong",
  "--green",
  "--red",
  "--gold",
] as const;

function check(
  palette: Palette,
  failures: string[],
  foreground: string,
  background: string,
  minimum: number,
): void {
  const front = palette.get(foreground);
  const back = palette.get(background);

  if (front === undefined || back === undefined) {
    failures.push(
      `${foreground} or ${background} is not a colour in this palette`,
    );
    return;
  }

  const ratio = contrast(front, back);

  if (ratio < minimum) {
    failures.push(
      `${foreground} on ${background}: ${ratio.toFixed(2)}:1, wants ${minimum}:1`,
    );
  }
}

test("the stylesheet defines at least the light palette", () => {
  expect([...PALETTES.keys()]).toContain("light");
});

for (const [name, palette] of PALETTES) {
  test(`${name}: body ink is comfortable on every surface it is drawn on`, () => {
    const failures: string[] = [];

    for (const surface of [...TEXT_SURFACES, ...WARM_SURFACES]) {
      check(palette, failures, "--ink", surface, AAA_TEXT);
    }

    expect(failures).toEqual([]);
  });

  test(`${name}: the two muted inks clear AA where each is allowed`, () => {
    const failures: string[] = [];

    // --ink-muted is for the cool surfaces only; that is the whole reason
    // --ink-muted-strong exists.
    for (const surface of TEXT_SURFACES) {
      check(palette, failures, "--ink-muted", surface, AA_TEXT);
    }

    for (const surface of [...TEXT_SURFACES, ...WARM_SURFACES]) {
      check(palette, failures, "--ink-muted-strong", surface, AA_TEXT);
    }

    expect(failures).toEqual([]);
  });

  test(`${name}: the ink scale runs in the order its names promise`, () => {
    // The invariant that has to survive the flip to dark, where "strong"
    // becomes *lighter* rather than darker: whatever direction the palette
    // runs, each tier must be more legible than the next one down.
    const surface = palette.get("--surface") as string;
    const against = (token: string) =>
      contrast(palette.get(token) as string, surface);

    expect(against("--ink")).toBeGreaterThan(against("--ink-muted-strong"));
    expect(against("--ink-muted-strong")).toBeGreaterThan(
      against("--ink-muted"),
    );
    expect(against("--ink-muted")).toBeGreaterThan(against("--ink-faint"));
  });

  test(`${name}: every accent is legible as text`, () => {
    const failures: string[] = [];

    for (const accent of ACCENTS) {
      for (const surface of TEXT_SURFACES) {
        check(palette, failures, accent, surface, AA_TEXT);
      }

      // A badge and a notice draw the accent on its own faint wash.
      if (palette.has(`${accent}-soft`)) {
        check(palette, failures, accent, `${accent}-soft`, AA_TEXT);
      }

      // ...and a pressed control fills with the accent and writes on it.
      check(palette, failures, "--on-accent", accent, AA_TEXT);
    }

    expect(failures).toEqual([]);
  });
}

/**
 * `--ink-faint` is knowingly below AA — it is separators and a disclosure
 * triangle, and `docs/a11y.md` records the argument for leaving it there. It
 * still must not get quietly worse when a palette is added, which is the one
 * claim worth holding it to.
 */
test("no palette makes the decorative ink fainter than light does", () => {
  const light = PALETTES.get("light") as Palette;
  const reference = contrast(
    light.get("--ink-faint") as string,
    light.get("--surface") as string,
  );
  const failures: string[] = [];

  for (const [name, palette] of PALETTES) {
    if (name === "light") {
      continue;
    }

    const ratio = contrast(
      palette.get("--ink-faint") as string,
      palette.get("--surface") as string,
    );

    if (ratio < reference - 0.005) {
      failures.push(
        `${name}: --ink-faint on --surface is ${ratio.toFixed(2)}:1,` +
          ` below light's ${reference.toFixed(2)}:1`,
      );
    }
  }

  expect(failures).toEqual([]);
});
