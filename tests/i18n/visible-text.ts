import { JSDOM } from "jsdom";

/**
 * Pull the text a reader actually sees out of a rendered page, for the
 * pseudolocale checks. Shared by the `bun test` gate
 * (`tests/i18n-pseudo.test.ts`) and the advisory report
 * (`scripts/i18n-pseudo-report.ts`) so both judge the same surface.
 *
 * Two things are deliberately in scope beyond text nodes: translatable
 * attributes (a screen-reader user "reads" an `aria-label`), and nothing else.
 * `<script>` and `<style>` bodies are excluded — an inline enhancement script's
 * English is a real i18n concern, but it is not *visible*, and including it
 * would report every identifier and CSS token in the page.
 */

/** Attributes whose values are prose the user encounters. */
const TEXT_ATTRIBUTES = [
  "alt",
  "aria-description",
  "aria-label",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
  "placeholder",
  "title",
] as const;

export interface VisibleText {
  /** Concatenated text nodes, excluding script/style, whitespace-collapsed. */
  readonly text: string;
  /** Every translatable attribute value found, in document order. */
  readonly attributes: readonly string[];
  /**
   * `text` plus the attribute values, for substring searching. Element
   * boundaries are NOT separated here, on purpose: a message whose rendering is
   * split across inline children (the `{" "}` splice idiom) still has to be
   * findable as one run of characters.
   */
  readonly all: string;
  /**
   * The same content tokenized into words, with element boundaries separated so
   * two adjacent labels do not fuse into a word that was never on the page
   * ("Audit log" beside "Admin" becoming "logAdmin"). For counting and
   * reporting, not for searching.
   */
  readonly words: readonly string[];
}

/**
 * Record ids, which pages do show (a user id under a roster row, the request id
 * on an error page). Stripped before {@link VisibleText.words} is tokenized:
 * splitting a UUID on its hyphens yields runs of hex letters that are
 * indistinguishable from English words — `dbbc`, `ecdc`, `added` — so the
 * advisory residue report would grow and shrink with whatever ids the seed
 * happened to mint, and its ratchet would flap for reasons no one could act on.
 *
 * Only `words` is filtered. `all` and `text` keep them, because the hard gate
 * searches those for catalog ids and must see the page exactly as rendered.
 */
const RECORD_ID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/**
 * `<script>`, `<style>`, `<template>` and `<noscript>` bodies, removed from the
 * *source* rather than from the parsed tree.
 *
 * They were always excluded — see below — but excluding them after parsing
 * still made jsdom build a CSSOM for every stylesheet on every page first, and
 * that turned out to poison it: run this gate over the fixture set and the
 * accessibility gate's `getComputedStyle` calls, in the same `bun test`
 * process, then start throwing inside jsdom's own border-shorthand handling on
 * a page that audits cleanly when run alone. Never parsing the stylesheets in
 * the first place is both faster and the thing that makes the two gates
 * independent again.
 *
 * None of these elements can contain its own end tag, so the non-greedy match
 * cannot run past the element it opened.
 */
const NON_VISIBLE_ELEMENTS =
  /<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

function collapse(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}

export function visibleText(html: string): VisibleText {
  const dom = new JSDOM(html.replaceAll(NON_VISIBLE_ELEMENTS, ""));
  const { document } = dom.window;

  // Belt and braces: a self-closing or unterminated one survives the strip
  // above, and an empty `<template>` is still a template.
  for (const node of document.querySelectorAll(
    "script, style, template, noscript",
  )) {
    node.remove();
  }

  const text = collapse(document.body?.textContent ?? "");
  // Text-node-by-text-node, so element boundaries become spaces.
  const separated = collapse(
    [...document.querySelectorAll("*")]
      .flatMap((element) =>
        [...element.childNodes]
          .filter((node) => node.nodeType === 3)
          .map((node) => node.textContent ?? ""),
      )
      .join(" "),
  );
  const attributes: string[] = [];

  // The `<title>` is chrome the user reads in the tab; it survives the removals
  // above because it lives in `<head>`, which `textContent` on body misses.
  const title = collapse(document.title);

  if (title.length > 0) {
    attributes.push(title);
  }

  for (const element of document.querySelectorAll("*")) {
    for (const name of TEXT_ATTRIBUTES) {
      const value = element.getAttribute(name);

      if (value !== null && collapse(value).length > 0) {
        attributes.push(collapse(value));
      }
    }
  }

  dom.window.close();

  const words = [separated, ...attributes]
    .join(" ")
    .replaceAll(RECORD_ID, " ")
    .split(/[^A-Za-z]+/)
    .filter((word) => word.length > 0);

  return { all: [text, ...attributes].join(" ␟ "), attributes, text, words };
}
