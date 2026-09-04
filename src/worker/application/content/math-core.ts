/**
 * The MathML Core post-pass: what MathJax draws with attributes, drawn with
 * classes and CSS instead.
 *
 * MathJax's internal tree is MathML 3, and MathML Core — the profile browsers
 * actually implement — dropped most of its presentation attributes on the
 * stated theory that CSS can do the job. It can, but nobody does it for you:
 * MathJax removed its native-MathML renderer in v3 and its docs say to
 * serialize the tree and implement the output yourself, which is what
 * `./math.ts` does. This module is the other half of that bargain, and the same
 * transformation the W3C Math WG ships as `w3c/mathml-polyfills` — moved to
 * save time, so a reader loads no JavaScript for it.
 *
 * Two constructs are rewritten, both measured in Chromium 152 and Firefox 154:
 *
 * - **Table rules.** `\hline` and `\begin{array}{c|c}` arrive as `columnlines`
 *   and `rowlines`, which Core ignores; Firefox still honours them. Borders on
 *   the `<mtd>`s draw the same rules in both, so the attributes are *removed*
 *   as the classes go on — leaving them would draw every rule twice in Firefox.
 * - **`<menclose>`.** Not in Core at all. It becomes an `<mrow>` carrying the
 *   classes for its notations: the element has to go, because Firefox draws a
 *   long-division sign for a `<menclose>` whose `notation` it cannot read, and
 *   a leftover `)` beside a boxed formula is worse than the missing box.
 *
 * What is deliberately *not* rewritten is `columnalign`, which is how
 * `\begin{aligned}` lines up its `=` signs. No CSS reaches it: `text-align` on
 * an `<mtd>` is honoured in Chromium only as "start" — every value, `right`
 * included, left-aligns — and `display: flex`, `float` and `margin: auto` on a
 * wrapper all leave the cell centred, because the cell's content is a math
 * layout box rather than an inline one. Firefox still reads the attribute, so
 * emitting it means an aligned environment is right there and centred in
 * Chromium; the alternative is to be wrong in both. `docs/carnap-markdown-v1.md`
 * says so to authors.
 */

import type { Element, ElementContent } from "hast";

/**
 * The class each `menclose` notation becomes, and — because an unlisted
 * notation throws — the list of notations an author may reach.
 *
 * These are exactly what the enabled TeX packages emit: `box` from `\boxed` and
 * `\fbox`, the four sides from an `array` column template's `|` and from a
 * leading or trailing `\hline`, and the two strikes from `cancel`. A notation
 * outside the list means either a newly enabled package or a change upstream,
 * and refusing it is what keeps "renders bare" from being the way an author
 * finds out.
 */
const ENCLOSE_CLASS_NAMES: Readonly<Record<string, string>> = {
  bottom: "math-enclose-bottom",
  box: "math-enclose-box",
  downdiagonalstrike: "math-enclose-strike-down",
  left: "math-enclose-left",
  right: "math-enclose-right",
  top: "math-enclose-top",
  updiagonalstrike: "math-enclose-strike-up",
};

/** The line styles a `columnlines`/`rowlines` entry may name. */
const RULE_CLASS_NAMES: Readonly<Record<string, string | null>> = {
  dashed: "-dashed",
  none: null,
  solid: "",
};

/**
 * A MathML list attribute, as MathML reads one: entries run left to right, and
 * the last entry repeats for every gap the list does not reach. `columnlines`
 * has one entry per gap *between* columns, so entry `i` is the rule drawn after
 * column `i`.
 */
function listEntry(value: string | undefined, index: number): string {
  const entries = (value ?? "").trim().split(/\s+/).filter(Boolean);

  if (entries.length === 0) {
    return "none";
  }

  return entries[Math.min(index, entries.length - 1)] as string;
}

/** The class a rule entry draws with, or `null` where it draws nothing. */
function ruleClassName(entry: string, side: "column" | "row"): string | null {
  const suffix = RULE_CLASS_NAMES[entry];

  return suffix === undefined || suffix === null
    ? null
    : `math-${side}-rule${suffix}`;
}

function isElement(node: ElementContent): node is Element {
  return node.type === "element";
}

function addClassName(node: Element, className: string): void {
  const existing = node.properties.className;

  node.properties.className = Array.isArray(existing)
    ? [...existing, className]
    : [className];
}

/**
 * The `<mtd>`s of one row, each with the index of the gap that follows it —
 * which is the last column it covers, since `\multicolumn` widens a cell and
 * the rule then belongs after the last column it spans, not the first.
 */
function rowCells(row: Element): { cell: Element; gap: number }[] {
  const cells: { cell: Element; gap: number }[] = [];
  let column = 0;

  for (const child of row.children) {
    if (!isElement(child) || child.tagName !== "mtd") {
      continue;
    }

    column += Number(child.properties.columnspan ?? 1) || 1;
    cells.push({ cell: child, gap: column - 1 });
  }

  return cells;
}

/**
 * Draw a table's rules with borders on its cells.
 *
 * The spacing goes on every cell of a ruled table rather than only the ones
 * carrying a border, because Core dropped `columnspacing` too: without it the
 * columns sit against the rule with nothing between them.
 */
function drawTableRules(table: Element): void {
  const columnLines = table.properties.columnlines as string | undefined;
  const rowLines = table.properties.rowlines as string | undefined;

  delete table.properties.columnlines;
  delete table.properties.rowlines;

  if (columnLines === undefined && rowLines === undefined) {
    return;
  }

  const rows = table.children
    .filter(isElement)
    .filter((child) => child.tagName === "mtr");
  let ruled = false;

  for (const [index, row] of rows.entries()) {
    // The rule below the last row would be the table's own bottom edge, which
    // `\hline` states as an enclosing `<menclose notation="bottom">` instead.
    const below =
      index === rows.length - 1
        ? null
        : ruleClassName(listEntry(rowLines, index), "row");

    const cells = rowCells(row);

    for (const [position, { cell, gap }] of cells.entries()) {
      // As with the last row: the rule after the last column is the table's
      // own right edge, and a `|` there arrives as an enclosure instead. A
      // `columnlines` list runs one short of the columns, so asking for the
      // gap after the last one would read the repeated final entry and draw a
      // rule the author did not write.
      const after =
        position === cells.length - 1
          ? null
          : ruleClassName(listEntry(columnLines, gap), "column");

      for (const className of [after, below]) {
        if (className !== null) {
          addClassName(cell, className);
          ruled = true;
        }
      }
    }
  }

  if (ruled) {
    addClassName(table, "math-ruled");
  }
}

/**
 * Turn one `<menclose>` into an `<mrow>` wearing its notations as classes.
 *
 * Throws on a notation with no drawing, which reaches the author as a failed
 * formula: `./math.ts` collects it beside a TeX syntax error, and the save
 * fails rather than storing a formula that renders as though the enclosure had
 * never been written.
 */
function drawEnclosure(node: Element): void {
  const notations = String(node.properties.notation ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  for (const notation of notations) {
    const className = ENCLOSE_CLASS_NAMES[notation];

    if (className === undefined) {
      throw new Error(
        `the enclosure it asks for (${notation}) is not one a browser can draw`,
      );
    }

    addClassName(node, className);
  }

  delete node.properties.notation;
  node.tagName = "mrow";
}

/**
 * Rewrite a rendered formula in place. Called on the `<math>` element the
 * visitor produces, before it reaches the sanitizer — which keeps `class` on
 * every element, and would have dropped an unknown one.
 */
export function drawWithCss(node: ElementContent): void {
  if (!isElement(node)) {
    return;
  }

  if (node.tagName === "mtable") {
    drawTableRules(node);
  } else if (node.tagName === "menclose") {
    drawEnclosure(node);
  }

  for (const child of node.children) {
    drawWithCss(child);
  }
}
