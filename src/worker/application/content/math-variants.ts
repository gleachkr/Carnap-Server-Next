/**
 * `mathvariant` as characters rather than as an attribute.
 *
 * MathJax writes `\mathbb{N}` as `<mi mathvariant="double-struck">N</mi>`, which
 * is how MathML worked before MathML Core. Core keeps only `mathvariant="normal"`
 * and says the rest belongs in the text: the Mathematical Alphanumeric Symbols
 * block exists precisely so that a blackboard-bold N is the character ℕ. Chromium
 * implements Core and so draws a plain italic N for the markup above — verified in
 * a browser, not assumed — which would silently turn every `\mathbb`, `\mathcal`,
 * `\mathfrak` and `\mathbf` in a logic course into the wrong letter.
 *
 * So the visitor substitutes here instead, and that is the better artifact
 * anyway: the stored HTML says which letter it means, so it survives copy-paste,
 * search, and a screen reader, none of which ever knew what the attribute meant.
 *
 * Two irregularities in the block make this a table rather than a formula. The
 * runs are otherwise contiguous, but Unicode had already encoded twenty-four of
 * these letters in Letterlike Symbols (ℕ, ℋ, ℨ…) and left their slots here
 * reserved; and the Greek runs interleave two symbol variants (ϴ, ∇) into the
 * middle of the alphabet.
 */

/** A–Z then a–z, contiguous, for each variant that has a full Latin run. */
const LATIN_STARTS: ReadonlyMap<string, number> = new Map([
  ["bold", 0x1d400],
  ["italic", 0x1d434],
  ["bold-italic", 0x1d468],
  ["script", 0x1d49c],
  ["bold-script", 0x1d4d0],
  ["fraktur", 0x1d504],
  ["double-struck", 0x1d538],
  ["bold-fraktur", 0x1d56c],
  ["sans-serif", 0x1d5a0],
  ["bold-sans-serif", 0x1d5d4],
  ["sans-serif-italic", 0x1d608],
  ["sans-serif-bold-italic", 0x1d63c],
  ["monospace", 0x1d670],
]);

const DIGIT_STARTS: ReadonlyMap<string, number> = new Map([
  ["bold", 0x1d7ce],
  ["double-struck", 0x1d7d8],
  ["sans-serif", 0x1d7e2],
  ["bold-sans-serif", 0x1d7ec],
  ["monospace", 0x1d7f6],
]);

/** Greek has runs for five variants only; the rest fall back to the plain letter. */
const GREEK_STARTS: ReadonlyMap<string, number> = new Map([
  ["bold", 0x1d6a8],
  ["italic", 0x1d6e2],
  ["bold-italic", 0x1d71c],
  ["bold-sans-serif", 0x1d756],
  ["sans-serif-bold-italic", 0x1d790],
]);

/**
 * The letters whose styled forms were encoded in Letterlike Symbols before this
 * block existed, keyed `variant letter`. Their slots in the runs above are
 * permanently reserved, so a plain offset lands on an unassigned code point.
 */
const LETTERLIKE: ReadonlyMap<string, number> = new Map([
  ["italic h", 0x210e],
  ["script B", 0x212c],
  ["script E", 0x2130],
  ["script F", 0x2131],
  ["script H", 0x210b],
  ["script I", 0x2110],
  ["script L", 0x2112],
  ["script M", 0x2133],
  ["script R", 0x211b],
  ["script e", 0x212f],
  ["script g", 0x210a],
  ["script o", 0x2134],
  ["fraktur C", 0x212d],
  ["fraktur H", 0x210c],
  ["fraktur I", 0x2111],
  ["fraktur R", 0x211c],
  ["fraktur Z", 0x2128],
  ["double-struck C", 0x2102],
  ["double-struck H", 0x210d],
  ["double-struck N", 0x2115],
  ["double-struck P", 0x2119],
  ["double-struck Q", 0x211a],
  ["double-struck R", 0x211d],
  ["double-struck Z", 0x2124],
]);

/**
 * Where each Greek code point sits within a 58-slot run. Α–Ρ run straight, then
 * the run inserts ϴ before Σ–Ω, then ∇, then α–ω, then six more symbol variants
 * and ∂. Writing the two alphabets as ranges and the seven interlopers as
 * entries keeps the arithmetic honest.
 */
const GREEK_SINGLETONS: ReadonlyMap<number, number> = new Map([
  [0x03f4, 0x11], // ϴ capital theta symbol
  [0x2207, 0x19], // ∇ nabla
  [0x2202, 0x33], // ∂ partial differential
  [0x03f5, 0x34], // ϵ epsilon symbol
  [0x03d1, 0x35], // ϑ theta symbol
  [0x03f0, 0x36], // ϰ kappa symbol
  [0x03d5, 0x37], // ϕ phi symbol
  [0x03f1, 0x38], // ϱ rho symbol
  [0x03d6, 0x39], // ϖ pi symbol
]);

function greekOffset(code: number): number | null {
  // Α–Ρ, the run's first seventeen.
  if (code >= 0x0391 && code <= 0x03a1) {
    return code - 0x0391;
  }

  // Σ–Ω, displaced by one because ϴ was inserted ahead of them.
  if (code >= 0x03a3 && code <= 0x03a9) {
    return code - 0x03a3 + 0x12;
  }

  // α–ω, after the capitals and ∇.
  if (code >= 0x03b1 && code <= 0x03c9) {
    return code - 0x03b1 + 0x1a;
  }

  return GREEK_SINGLETONS.get(code) ?? null;
}

function styledCodePoint(code: number, variant: string): number | null {
  const letterlike = LETTERLIKE.get(
    `${variant} ${String.fromCodePoint(code)}`,
  );

  if (letterlike !== undefined) {
    return letterlike;
  }

  const latin = LATIN_STARTS.get(variant);

  if (latin !== undefined) {
    if (code >= 0x41 && code <= 0x5a) {
      return latin + (code - 0x41);
    }

    if (code >= 0x61 && code <= 0x7a) {
      return latin + (code - 0x61) + 26;
    }
  }

  const digit = DIGIT_STARTS.get(variant);

  if (digit !== undefined && code >= 0x30 && code <= 0x39) {
    return digit + (code - 0x30);
  }

  const greek = GREEK_STARTS.get(variant);

  if (greek !== undefined) {
    const offset = greekOffset(code);

    if (offset !== null) {
      return greek + offset;
    }
  }

  return null;
}

/**
 * The text a token element should carry to mean it in `variant`.
 *
 * Character by character, because a variant may cover part of a run — `bold`
 * has Latin, Greek and digits, `script` only Latin — and an author who writes
 * `\mathbf{v_+}` should get a bold v and an ordinary plus rather than nothing.
 * A character no run covers is left as it was; no renderer could have shown it
 * styled either, since the styled form does not exist to be shown.
 */
export function styledMathText(text: string, variant: string): string {
  let styled = "";

  for (const character of text) {
    const code = character.codePointAt(0);
    const replacement =
      code === undefined ? null : styledCodePoint(code, variant);

    styled +=
      replacement === null ? character : String.fromCodePoint(replacement);
  }

  return styled;
}

/** The token elements whose text `mathvariant` styles. */
const TOKEN_ELEMENTS: ReadonlySet<string> = new Set([
  "mi",
  "mn",
  "mo",
  "ms",
  "mtext",
]);

export function isMathTokenElement(tagName: string): boolean {
  return TOKEN_ELEMENTS.has(tagName);
}
