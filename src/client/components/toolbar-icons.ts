/**
 * The glyphs on the tree and Prawitz editors' toolbars, and in the legend the
 * help dialog draws of them.
 *
 * Nothing here is a picture of an action in the abstract; there is no shared
 * visual vocabulary for "add a premise". Each glyph is instead a miniature of
 * the notation the student is already reading: a short dash is a formula, the
 * long rule is an inference line, square brackets are an assumption leaf
 * (`[A]¹`, as Prawitz writes it), and a `+` or `×` sits where the new or
 * removed thing is. So *add premise* is a `+` beside a dash above a line, *apply
 * rule below* is a `+` under one, and *delete* is an `×` above a line with the
 * conclusion left standing below it — which is what delete does. Undo and redo
 * borrow the arrows everything else uses.
 *
 * Two constraints shaped the drawing. A `+` centred over a line reads as `±`
 * and one under it as `÷` at button size — the wrong association to invite in
 * a logic course — so the `+` sits beside an existing premise, as a new
 * premise would. And everything is a stroke in `currentColor`: the buttons are
 * inside a shadow root, where an author's theme cannot restyle text but the
 * icons follow the button's colour for free. That is why the toolbars carry no
 * visible words at all; the name is the button's `aria-label`, and the legend
 * in the help dialog is where a student learns what a glyph means.
 *
 * The paths are data rather than markup because two consumers want them in
 * different shapes: the help dialog builds DOM (see {@link createToolbarIcon})
 * and the editors render JSX (see `toolbar-icon.tsx`).
 */

import toolbarStyles from "./toolbar-icons.css" with { type: "text" };

export type ToolbarIconName =
  | "add-above"
  | "add-assumption-above"
  | "apply-below"
  | "delete"
  | "new-assumption"
  | "redo"
  | "undo";

export const TOOLBAR_ICON_VIEWBOX = "0 0 20 20";

/** Each icon's strokes, as `<path d>` values over {@link TOOLBAR_ICON_VIEWBOX}. */
export const TOOLBAR_ICON_PATHS: Readonly<
  Record<ToolbarIconName, readonly string[]>
> = {
  // A dash and a `+` above the line, a dash below: another premise, here.
  "add-above": [
    "M3.5 5.5h4.5",
    "M13.5 3v5M11 5.5h5",
    "M2 11h16",
    "M7 15.5h6",
  ],
  // `[+]` above the line: the new premise is an assumption.
  "add-assumption-above": [
    "M10 3v5M7.5 5.5h5",
    "M4.5 1.8h-1.8v7.4h1.8M15.5 1.8h1.8v7.4h-1.8",
    "M2 12.5h16",
    "M7 17h6",
  ],
  // Two premises over a line, and a `+` where their conclusion goes.
  "apply-below": ["M3 4.5h5M12 4.5h5", "M2 8.5h16", "M10 11.5v5M7.5 14h5"],
  // `×` above the line, the conclusion still below it.
  delete: ["M7.5 3.5l5 5M12.5 3.5l-5 5", "M2 11h16", "M7 15.5h6"],
  // `[+]` on its own: a leaf with no inference under it.
  "new-assumption": ["M10 6.5v7M6.5 10h7", "M5.5 4h-2v12h2M14.5 4h2v12h-2"],
  redo: ["M13 4.5L16.5 8 13 11.5", "M16.5 8H8a4 4 0 0 0 0 8h4"],
  undo: ["M7 4.5L3.5 8l3.5 3.5", "M3.5 8h8.5a4 4 0 0 1 0 8H8"],
};

/** How every path is stroked; the JSX component spells the same attributes. */
export const TOOLBAR_ICON_STROKE = {
  fill: "none",
  stroke: "currentColor",
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
  "stroke-width": "1.7",
} as const;

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * The icon as an element, for the framework-free help dialog. Decorative: the
 * row it sits in names the action in words, so the picture says nothing a
 * reader would miss.
 */
export function createToolbarIcon(name: ToolbarIconName): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "toolbar-icon");
  svg.setAttribute("viewBox", TOOLBAR_ICON_VIEWBOX);
  svg.setAttribute("aria-hidden", "true");

  const group = document.createElementNS(SVG_NS, "g");

  for (const [attribute, value] of Object.entries(TOOLBAR_ICON_STROKE)) {
    group.setAttribute(attribute, value);
  }

  for (const d of TOOLBAR_ICON_PATHS[name]) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    group.appendChild(path);
  }

  svg.appendChild(group);

  return svg;
}

/** The toolbar's look, shared by both editors; appended to their shadow styles. */
export const TOOLBAR_STYLES = toolbarStyles;
