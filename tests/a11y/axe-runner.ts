import axe from "axe-core";
import { JSDOM } from "jsdom";

/**
 * Tier 1 accessibility engine: run axe-core over a server-rendered HTML string
 * inside jsdom. This is the fast, always-on half of the a11y strategy (see
 * `docs/a11y.md`) — it needs no browser and no running server, so it lives in
 * the normal `bun test` gate.
 *
 * jsdom has no layout engine, so any rule that depends on rendered geometry or
 * computed visibility (contrast, target size, things axe would mark
 * `incomplete` for lack of a viewport) is unreliable here and is disabled
 * below. Those criteria are the browser tier's job (`scripts/a11y-audit.mjs`),
 * where real Chromium supplies the rendering.
 */

/** WCAG 2.2 AA — the tags we hold the product to. */
export const AA_TAGS: readonly string[] = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
];

/**
 * Rules that need real rendering (layout, computed style, visibility). jsdom
 * can't judge them, so we defer them to the browser tier rather than emit
 * noise or false "incomplete" results here.
 */
export const LAYOUT_DEPENDENT_RULES: readonly string[] = [
  "color-contrast",
  "color-contrast-enhanced",
  "target-size",
  "scrollable-region-focusable",
  "meta-viewport",
];

/** One axe violation, flattened to a single offending node. */
export interface Finding {
  /** axe rule id, e.g. `label`, `image-alt`. */
  readonly rule: string;
  /** axe impact, e.g. `serious`. `null` when axe omits it. */
  readonly impact: string | null;
  /** The WCAG success-criterion tags (e.g. `wcag111`), for reporting. */
  readonly wcag: readonly string[];
  /** The fixture the finding was seen on. */
  readonly fixture: string;
  /** A readable target selector (shadow-DOM paths flattened). */
  readonly target: string;
  /** axe's human-readable failure summary for this node. */
  readonly detail: string;
  /**
   * Stable identity used to diff against the committed baseline. Deliberately
   * excludes `detail`/`impact` (which can reword between axe versions) so the
   * ratchet keys only on *what* is wrong and *where*.
   */
  readonly fingerprint: string;
}

/**
 * Attach every `<template shadowrootmode>` as a real shadow root.
 *
 * jsdom's parser does not do declarative shadow DOM (verified against 29.1.1:
 * the host's `shadowRoot` stays null and the `<template>` sits there inertly), and
 * axe does not look inside a template. Without this the audit sees only the light
 * DOM of the six exercise widgets — their prompt, their slotted labels, their
 * action bar — and none of the chrome that *is* the widget: the group and its
 * legend, the option inputs, the grid of cells, the proof source. Every finding
 * in there was invisible to this tier.
 *
 * Depth-first and re-entrant, because a shadow root may hold hosts of its own.
 */
function hydrateShadowRoots(root: Document | ShadowRoot | Element): void {
  for (const template of root.querySelectorAll<HTMLTemplateElement>(
    "template[shadowrootmode]",
  )) {
    const host = template.parentElement;

    if (host === null || host.shadowRoot !== null) {
      continue;
    }

    const mode =
      template.getAttribute("shadowrootmode") === "closed"
        ? "closed"
        : "open";
    // A closed root is closed to *scripts*, not to assistive technology — axe
    // reaches it through its own traversal — so audit both alike.
    const shadow = host.attachShadow({ mode });
    shadow.append(...Array.from(template.content.childNodes));
    template.remove();
    hydrateShadowRoots(shadow);
  }
}

function flattenTarget(target: unknown): string {
  // axe target is `string | string[]`; for shadow DOM it nests one level.
  if (Array.isArray(target)) {
    return target.map(flattenTarget).join(" ");
  }
  return String(target);
}

/**
 * Run the AA ruleset (minus the layout-dependent rules) over `html` and return
 * one `Finding` per offending node.
 */
export async function runAxe(
  html: string,
  fixture: string,
): Promise<Finding[]> {
  // `outside-only` lets us inject axe via `window.eval` without executing the
  // page's own inline scripts — we audit the delivered markup, not a
  // JS-mutated DOM (that is the browser tier's remit).
  const dom = new JSDOM(html, {
    pretendToBeVisual: true,
    runScripts: "outside-only",
  });
  const { window } = dom;

  try {
    hydrateShadowRoots(window.document);
    window.eval(axe.source);

    const runner = (window as unknown as { axe: typeof axe }).axe;
    const results = await runner.run(window.document, {
      resultTypes: ["violations"],
      runOnly: { type: "tag", values: [...AA_TAGS] },
      rules: Object.fromEntries(
        LAYOUT_DEPENDENT_RULES.map((rule) => [rule, { enabled: false }]),
      ),
    });

    const findings: Finding[] = [];
    for (const violation of results.violations) {
      const wcag = violation.tags.filter((tag) => tag.startsWith("wcag"));
      for (const node of violation.nodes) {
        const target = flattenTarget(node.target);
        findings.push({
          detail: node.failureSummary ?? "",
          fingerprint: `${fixture} :: ${violation.id} :: ${target}`,
          fixture,
          impact: node.impact ?? violation.impact ?? null,
          rule: violation.id,
          target,
          wcag,
        });
      }
    }
    return findings;
  } finally {
    window.close();
    // A closed jsdom window is only *eligible* for collection, and one of these
    // is enormous: a whole document plus an evaluated copy of axe-core. Across
    // the fixture set that is gigabytes of garbage, and bun's collector will
    // happily let it accumulate while the loop keeps allocating — a `bun test`
    // run covering this file and the pseudolocale gate together grew past 30 GB
    // and stopped making progress. Collecting each one as it is finished with
    // keeps the whole suite inside a few hundred megabytes.
    Bun.gc(true);
  }
}
