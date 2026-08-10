import { liteAdaptor } from "@mathjax/src/js/adaptors/liteAdaptor.js";
import { STATE } from "@mathjax/src/js/core/MathItem.js";
import type {
  MmlNode,
  TextNode,
} from "@mathjax/src/js/core/MmlTree/MmlNode.js";
import { MmlVisitor } from "@mathjax/src/js/core/MmlTree/MmlVisitor.js";
import { RegisterHTMLHandler } from "@mathjax/src/js/handlers/html.js";
import { TeX } from "@mathjax/src/js/input/tex.js";
import "@mathjax/src/js/input/tex/ams/AmsConfiguration.js";
import "@mathjax/src/js/input/tex/base/BaseConfiguration.js";
import "@mathjax/src/js/input/tex/boldsymbol/BoldsymbolConfiguration.js";
import "@mathjax/src/js/input/tex/braket/BraketConfiguration.js";
import "@mathjax/src/js/input/tex/mathtools/MathtoolsConfiguration.js";
import "@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js";
import "@mathjax/src/js/input/tex/textmacros/TextMacrosConfiguration.js";
import "@mathjax/src/js/input/tex/unicode/UnicodeConfiguration.js";
import "@mathjax/src/js/input/tex/verb/VerbConfiguration.js";
import { mathjax } from "@mathjax/src/js/mathjax.js";
import type { Element, ElementContent } from "hast";
import { isMathTokenElement, styledMathText } from "./math-variants";

/**
 * TeX in, MathML out, at author-save time.
 *
 * The output format is native MathML rather than MathJax's own SVG or CHTML, so
 * a formula in a saved revision is around 450 bytes of markup the browser lays
 * out itself instead of ~5 KB of positioned paths. That choice is what keeps the
 * Worker inside its startup budget: the TeX input jax alone is ~85 KB gzipped
 * and evaluates in ~24 ms, where a working SVG build (MathJax 4 loads font
 * ranges on demand, and a Worker has no async loader, so the fonts must all be
 * bundled) is 1.6 MB and ~114 ms. It also costs a reader nothing — see below.
 *
 * The cost lands entirely on the author. `compileCarnapMarkdown` stores rendered
 * HTML in the artifact and `renderCompiledContent` hands that same HTML back, so
 * a student loading a lesson does no math work at all; only saving a revision
 * does. Within a save, the first formula costs ~31 ms and each one after ~0.2 ms.
 *
 * What MathML Core cannot do, and this therefore does not offer: `bussproofs`
 * (it measures boxes, which needs an output jax we deliberately do not build),
 * rules inside `\begin{array}` and `\hline`, `\cancel`, and automatic line
 * breaking for long displayed equations. `docs/carnap-markdown-v1.md` says so to
 * authors.
 */

/**
 * A formula that would not parse, positioned in the author's source.
 *
 * Collected rather than thrown: a document with three broken formulas should
 * list three problems the way a document with three broken directives does,
 * not stop at the first. `compileCarnapMarkdown` turns these into diagnostics,
 * which fails the save — so the `<merror>` MathJax would otherwise have been
 * happy to render never reaches a student.
 */
export interface MathFailure {
  readonly column: number;
  readonly detail: string;
  readonly line: number;
  readonly tex: string;
}

export interface MathCompiler {
  /**
   * Problems found so far. Mutable and shared for one document's compile, like
   * the footnote counter beside it.
   */
  readonly failures: readonly MathFailure[];
  render(
    tex: string,
    display: boolean,
    line: number,
    column: number,
  ): ElementContent;
}

/**
 * The TeX packages an author may use.
 *
 * `html`, `texhtml` and `require` are absent on purpose: they are what define
 * `\href`, `\class`, `\style`, `\cssId` and the ability to pull in further
 * packages at parse time, and without them there is no construct in the dialect
 * that can put an author-chosen attribute into the document. `color` and
 * `colortbl` are absent for a duller reason — they work by writing a `style`
 * attribute, which the sanitizer strips, so enabling them would only produce
 * formulas that silently lose their colour.
 *
 * `noundefined` is absent because its whole purpose is to render an unknown
 * macro as a red box and carry on, and this compiler would rather tell the
 * author.
 */
const TEX_PACKAGES = [
  "base",
  "ams",
  "boldsymbol",
  "braket",
  "mathtools",
  "newcommand",
  "textmacros",
  "unicode",
  "verb",
];

/**
 * MathJax's tree walker, retargeted from a string to hast.
 *
 * Going straight to hast rather than serializing and re-parsing means no second
 * parser in the bundle and no round trip through markup that would have to be
 * escaped and unescaped correctly. `getKind` and `getAttributeList` are the two
 * hooks the base class offers, and they are exactly what a hast element needs.
 */
class HastVisitor extends MmlVisitor {
  override visitTextNode(node: TextNode): ElementContent {
    return { type: "text", value: node.getText() };
  }

  /**
   * `\text{}` containing raw XML, and the `html` package's nodes. The package
   * is not enabled and the parser has no other way to make one, so reaching
   * either of these means something has changed; dropping the content is the
   * safe reading, and the sanitizer would not have let it through anyway.
   */
  override visitXMLNode(): ElementContent {
    return { type: "text", value: "" };
  }

  override visitHtmlNode(): ElementContent {
    return { type: "text", value: "" };
  }

  /**
   * An inferred mrow is MathJax's bookkeeping for "these children belong to one
   * argument", not markup the author asked for. Splicing its children into the
   * parent keeps the output the size it should be.
   */
  visitInferredMrowNode(node: MmlNode): ElementContent[] {
    return this.visitChildren(node);
  }

  override visitDefault(node: MmlNode): Element {
    const tagName = this.getKind(node);
    const properties: Record<string, string> = {};
    let variant: string | null = null;

    for (const [name, value] of Object.entries(this.getAttributeList(node))) {
      // `data-latex` and `data-mjx-*` are MathJax's own annotations — the
      // original TeX and its parse classification. They are stored in every
      // saved revision if kept, and nothing reads them.
      if (name.startsWith("data-")) {
        continue;
      }

      if (name === "mathvariant" && value !== "normal") {
        variant = String(value);
        continue;
      }

      properties[name] = String(value);
    }

    const children = this.visitChildren(node);

    if (variant === null || !isMathTokenElement(tagName)) {
      return { children, properties, tagName, type: "element" };
    }

    // The variant moves into the characters (see `math-variants.ts`), and the
    // element is marked upright so nothing italicizes a letter that is already
    // saying which alphabet it belongs to.
    return {
      children: children.map((child) =>
        child.type === "text"
          ? { ...child, value: styledMathText(child.value, variant) }
          : child,
      ),
      properties: { ...properties, mathvariant: "normal" },
      tagName,
      type: "element",
    };
  }

  private visitChildren(node: MmlNode): ElementContent[] {
    return node.childNodes.flatMap(
      (child) => this.visitNode(child) as ElementContent | ElementContent[],
    );
  }
}

/**
 * MathJax needs a document handler registered before `mathjax.document` will
 * build anything, and registering twice stacks handlers that then both run. One
 * registration per isolate, at module load, which is also where the ~24 ms of
 * startup this module costs is spent.
 */
const adaptor = liteAdaptor();

RegisterHTMLHandler(adaptor);

const visitor = new HastVisitor();

/** What a formula that failed to parse leaves in the tree. */
function failedMath(tex: string): Element {
  return {
    children: [{ type: "text", value: tex }],
    properties: { className: ["math-error"] },
    tagName: "code",
    type: "element",
  };
}

function failureDetail(error: unknown): string {
  return error instanceof Error || typeof error === "object"
    ? String((error as { readonly message?: unknown }).message ?? error)
    : String(error);
}

/**
 * A TeX engine for one document's compile.
 *
 * One per compile, not one per isolate, and that is the whole reason this is a
 * factory: `\newcommand` writes into the parser's macro table, so a shared
 * instance would let a macro defined in one author's revision resolve in the
 * next revision compiled by the same isolate — which works locally, fails in
 * production, and is invisible either way. Scoped like this, a definition is
 * good for the document that made it and dead afterwards, which is what an
 * author means by writing one at the top of a page.
 *
 * Built on the first formula rather than here, because most documents have no
 * math at all and building the parse tables is the expensive part of a compile
 * that would otherwise never touch them.
 */
export function createMathCompiler(): MathCompiler {
  const failures: MathFailure[] = [];
  let document: ReturnType<typeof mathjax.document> | null = null;

  const engine = () => {
    document ??= mathjax.document("", {
      InputJax: new TeX({
        // Turn a TeX error into a thrown one rather than an `<merror>` node.
        // Without this the compiler cheerfully stores "Undefined control
        // sequence" as the rendered formula and a student finds out.
        formatError: (_jax: unknown, error: unknown) => {
          throw error;
        },
        packages: TEX_PACKAGES,
      }),
    });

    return document;
  };

  return {
    failures,
    render(tex, display, line, column) {
      try {
        return visitor.visitNode(
          engine().convert(tex, { display, end: STATE.CONVERT }) as MmlNode,
        ) as ElementContent;
      } catch (error) {
        failures.push({
          column,
          detail: failureDetail(error),
          line,
          tex,
        });

        return failedMath(tex);
      }
    },
  };
}
