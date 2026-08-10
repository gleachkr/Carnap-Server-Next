import { escapeHtml } from "../../application/content/render-support";
import type { ContentNode } from "../../domain/content";
import type { Translator } from "../../i18n/translator";

/**
 * The read-only panel a shown `:::aufbau-mm0` block renders: the axioms and
 * notation in scope for the proof exercises below it, behind a disclosure.
 *
 * Rendered here rather than at compile time because the summary names the thing
 * in words ("Theory: prop"), and compiled documents are stored — an author who
 * saves a lesson in English would otherwise have frozen that word for every
 * later reader, in every language.
 *
 * Most lessons want the theory collected but not shown (the student is given the
 * rules by the textbook, not the file); `show` on the directive is what puts one
 * of these on the page, so the ones that do appear are deliberate.
 */
export function renderTheoryPanel(
  node: Extract<ContentNode, { readonly kind: "theory" }>,
  i18n: Translator,
): string {
  return (
    `<details class="aufbau-theory">` +
    `<summary class="aufbau-theory-summary">` +
    `<span class="aufbau-theory-kicker">${escapeHtml(i18n.t("Theory"))}</span>` +
    `<span class="aufbau-theory-name">${escapeHtml(node.name)}</span>` +
    `</summary>` +
    `<pre class="aufbau-theory-source">${escapeHtml(node.mm0)}</pre>` +
    `</details>`
  );
}

/**
 * The panel's look: a closed disclosure should read as a quiet label the reader
 * may open, not as another card competing with the exercises around it.
 *
 * Closed, it is a single line — a small-caps kicker in the exercise-legend
 * idiom, then the theory's name set in the source face, since the name is an
 * identifier the author writes in `theory="…"`. Open, the source hangs below a
 * hairline inside the same box.
 *
 * The `<pre>` has to undo the page's own block-code framing (fill, border,
 * radius): nested inside the panel it would draw a second box a hairline inside
 * the first. What it keeps is the scroll — MM0 lines are long and a theory can
 * run to dozens of them, so it scrolls in both directions inside a bounded box
 * rather than stretching the lesson.
 */
export const THEORY_PANEL_STYLES = `
  .aufbau-theory {
    background: var(--surface-soft);
    border: 1px solid var(--rule-soft);
    border-radius: 6px;
    margin: 1.1rem 0;
  }

  .aufbau-theory-summary {
    align-items: baseline;
    cursor: pointer;
    display: flex;
    gap: 0.5rem;
    padding: 0.45rem 0.75rem;
    /* Both halves of removing the default triangle: the standard property and
       the WebKit pseudo-element that predates it. */
    list-style: none;
  }

  .aufbau-theory-summary::-webkit-details-marker {
    display: none;
  }

  /* A disclosure triangle drawn in borders rather than set as a glyph: "▸" is
     rendered by a fallback font on many systems, at a size and baseline nothing
     here controls. */
  .aufbau-theory-summary::before {
    border-bottom: 0.24em solid transparent;
    border-left: 0.34em solid currentcolor;
    border-top: 0.24em solid transparent;
    color: var(--ink-faint);
    content: "";
    display: inline-block;
    transform-origin: 0.14em 50%;
    transition: transform 120ms ease;
  }

  .aufbau-theory[open] > .aufbau-theory-summary::before {
    transform: rotate(90deg);
  }

  @media (prefers-reduced-motion: reduce) {
    .aufbau-theory-summary::before {
      transition: none;
    }
  }

  /* The same small caps an exercise group's legend uses, so a theory reads as
     chrome of the same rank as the exercises it serves. */
  .aufbau-theory-kicker {
    color: var(--ink-muted);
    font-size: 0.74rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .aufbau-theory-name {
    color: var(--ink);
    font-family: "Fira Code", ui-monospace, monospace;
    font-size: 0.85rem;
    font-variant-ligatures: none;
  }

  .aufbau-theory-summary:hover .aufbau-theory-kicker,
  .aufbau-theory-summary:hover .aufbau-theory-name {
    color: var(--blue-strong);
  }

  .aufbau-theory-source {
    background: none;
    border: 0;
    border-radius: 0;
    border-top: 1px solid var(--rule-soft);
    margin: 0;
    max-height: 22rem;
    overflow: auto;
    padding: 0.7rem 0.85rem;
  }
`;
