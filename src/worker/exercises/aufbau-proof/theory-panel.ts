import { escapeHtml } from "../../application/content/render-support";
import type { ContentNode } from "../../domain/content";
import type { Translator } from "../../i18n/translator";
import theoryPanelStyles from "./theory-panel.css" with { type: "text" };

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

/** The look; the prose is in the stylesheet, with the rules. */
export const THEORY_PANEL_STYLES = theoryPanelStyles;
