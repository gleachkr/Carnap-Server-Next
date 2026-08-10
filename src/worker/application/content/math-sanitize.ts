/**
 * What a `<math>` element is allowed to be, for the content sanitizer.
 *
 * Kept apart from the renderer so the allowlist can be read — and tested —
 * without loading MathJax. Everything here is a security decision rather than a
 * rendering one: the compiler runs an author's TeX, and while the packages it
 * enables define nothing that reaches HTML, the sanitizer is what makes that a
 * belt-and-braces claim rather than a promise about someone else's parser.
 *
 * Three MathML elements are omitted deliberately, and none of them should be
 * added back for a rendering reason:
 *
 * - `annotation-xml`, because `encoding="text/html"` switches the HTML parser
 *   out of foreign content and back into HTML in the middle of a subtree the
 *   sanitizer already approved as MathML. It is the classic mutation-XSS route
 *   into a sanitized document.
 * - `mglyph`, which takes a `src`.
 * - `malignmark`, which — like `mglyph` — is one of the two elements whose
 *   presence changes how the tokenizer treats the text around it.
 *
 * `style` is likewise absent from every attribute list and must stay absent:
 * content documents are isolated, but a `style` attribute the author controls is
 * still arbitrary CSS in a page a student is reading.
 */

/**
 * The MathML Core element set, less the three above. `maction` and `menclose`
 * are here even though browsers no longer draw them: they are inert, and the
 * alternative is silently dropping a subtree's contents along with its wrapper.
 */
export const MATHML_TAG_NAMES: readonly string[] = [
  "annotation",
  "maction",
  "menclose",
  "merror",
  "mfrac",
  "mi",
  "mmultiscripts",
  "mn",
  "mo",
  "mover",
  "mpadded",
  "mphantom",
  "mprescripts",
  "mroot",
  "mrow",
  "ms",
  "mspace",
  "msqrt",
  "mstyle",
  "msub",
  "msubsup",
  "msup",
  "mtable",
  "mtd",
  "mtext",
  "mtr",
  "munder",
  "munderover",
  "none",
  "semantics",
];

/**
 * Presentation attributes any MathML element may carry. `mathvariant` is on the
 * list because `normal` survives the visitor's character substitution — it is
 * the one value MathML Core kept, and the one that stops a single letter being
 * italicized.
 */
const MATHML_GLOBAL_ATTRIBUTES: readonly string[] = [
  "dir",
  "displaystyle",
  "mathbackground",
  "mathcolor",
  "mathsize",
  "mathvariant",
  "scriptlevel",
];

/**
 * Per-element attributes, merged into the content schema. Sizes and spacings are
 * lengths; the sanitizer does not parse them, and a nonsense length is a
 * rendering nuisance rather than a hazard.
 */
export const MATHML_ATTRIBUTES: Readonly<Record<string, readonly string[]>> =
  {
    annotation: ["encoding"],
    maction: ["actiontype", "selection"],
    math: ["alttext", "display", "xmlns"],
    menclose: ["notation"],
    mfrac: ["denomalign", "linethickness", "numalign"],
    mmultiscripts: ["subscriptshift", "superscriptshift"],
    mo: [
      "accent",
      "fence",
      "form",
      "largeop",
      "lspace",
      "maxsize",
      "minsize",
      "movablelimits",
      "rspace",
      "separator",
      "stretchy",
      "symmetric",
    ],
    mover: ["accent", "align"],
    mpadded: ["depth", "height", "lspace", "voffset", "width"],
    ms: ["lquote", "rquote"],
    mspace: ["depth", "height", "width"],
    msub: ["subscriptshift"],
    msubsup: ["subscriptshift", "superscriptshift"],
    msup: ["superscriptshift"],
    mtable: [
      "align",
      "columnalign",
      "columnlines",
      "columnspacing",
      "equalcolumns",
      "equalrows",
      "frame",
      "framespacing",
      "minlabelspacing",
      "rowalign",
      "rowlines",
      "rowspacing",
      "side",
      "width",
    ],
    mtd: ["columnalign", "columnspan", "rowalign", "rowspan"],
    mtr: ["columnalign", "rowalign"],
    munder: ["accentunder", "align"],
    munderover: ["accent", "accentunder", "align"],
  };

/** The tag names above plus `math` itself, which carries its own attributes. */
export function mathmlTagNames(): string[] {
  return ["math", ...MATHML_TAG_NAMES];
}

/**
 * The attribute allowlist as the sanitizer wants it: every MathML element keyed
 * to its own attributes plus the presentation set every one of them may carry.
 */
export function mathmlAttributes(): Record<string, string[]> {
  const attributes: Record<string, string[]> = {};

  for (const tagName of mathmlTagNames()) {
    attributes[tagName] = [
      ...MATHML_GLOBAL_ATTRIBUTES,
      ...(MATHML_ATTRIBUTES[tagName] ?? []),
    ];
  }

  return attributes;
}
