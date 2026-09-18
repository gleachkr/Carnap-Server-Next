import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import type { Root } from "mdast";

import { markdownLanguage } from "../src/client/markdown-editor";
import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import {
  inlineMathKind,
  markdownParser,
  renderMarkdownSource,
} from "../src/worker/application/content/markdown";
import { styledMathText } from "../src/worker/application/content/math-variants";
import { resolveMessage } from "../src/worker/i18n/translator";

setDefaultTimeout(30_000);

async function html(source: string): Promise<string> {
  return renderMarkdownSource(source);
}

/** The rendered HTML of a document that must compile. */
async function compiledHtml(source: string): Promise<string> {
  const result = await compileCarnapMarkdown(source);

  if (!result.ok) {
    throw new Error(
      `expected a clean compile, got: ${result.diagnostics
        .map((entry) => resolveMessage(entry, (message) => message))
        .join("; ")}`,
    );
  }

  return result.artifact.document.nodes
    .map((node) => (node.kind === "markdown" ? node.html : ""))
    .join("\n");
}

describe("math syntax", () => {
  test("renders inline and displayed formulas as MathML", async () => {
    const inline = await html("The claim $P \\to Q$ holds.");

    expect(inline).toContain(
      '<math xmlns="http://www.w3.org/1998/Math/MathML">',
    );
    expect(inline).not.toContain('display="block"');
    expect(inline).toContain("<mi>P</mi>");

    const fenced = await html("$$\n\\frac{a}{b}\n$$");

    expect(fenced).toContain('display="block"');
    expect(fenced).toContain("<mfrac>");
  });

  test("treats $$…$$ as displayed even on a single line", async () => {
    // Upstream only reads `$$` as display when it fences its own lines, which
    // would typeset this inline — a cramped fraction with nothing to say why.
    expect(await html("$$\\frac{a}{b}$$")).toContain('display="block"');
    expect(await html("before $$\\frac{a}{b}$$ after")).toContain(
      'display="block"',
    );
  });

  test("leaves prose that merely contains dollars alone", async () => {
    // The run `$5 and $` closes on a space, so Pandoc's rule says it is not a
    // formula. Without the rule this sentence silently sets "5 and" as maths.
    const prose = await html("it cost $5 and then $10 in total");

    expect(prose).toBe("<p>it cost $5 and then $10 in total</p>");
    expect(prose).not.toContain("<math");

    expect(await html("padded $ x $ stays literal")).not.toContain("<math");
    expect(await html("escaped \\$5 and \\$10")).toBe(
      "<p>escaped $5 and $10</p>",
    );
  });
});

describe("mathvariant as characters", () => {
  // Chromium implements MathML Core, which dropped every `mathvariant` value
  // but `normal` — so a blackboard-bold N has to *be* ℕ or it draws as N.
  test("substitutes the Mathematical Alphanumeric Symbols", async () => {
    const rendered = await html(
      "$\\mathbb{N}$ $\\mathcal{P}$ $\\mathfrak{M}$ $\\mathbf{v}$ $\\mathtt{y}$",
    );

    expect(rendered).toContain("ℕ");
    expect(rendered).toContain("𝒫");
    expect(rendered).toContain("𝔐");
    expect(rendered).toContain("𝐯");
    expect(rendered).toContain("𝚢");
    expect(rendered).not.toContain('mathvariant="double-struck"');
    expect(rendered).not.toContain('mathvariant="fraktur"');
  });

  test("uses the Letterlike Symbols where the run reserves a slot", () => {
    // These twenty-four were encoded before the block existed, so a plain
    // offset lands on an unassigned code point.
    expect(styledMathText("CHNPQRZ", "double-struck")).toBe("ℂℍℕℙℚℝℤ");
    expect(styledMathText("BEFHILMR", "script")).toBe("ℬℰℱℋℐℒℳℛ");
    expect(styledMathText("ego", "script")).toBe("ℯℊℴ");
    expect(styledMathText("CHIRZ", "fraktur")).toBe("ℭℌℑℜℨ");
    expect(styledMathText("h", "italic")).toBe("ℎ");
  });

  test("covers Greek, digits, and the symbol variants spliced into the run", () => {
    expect(styledMathText("ΑΡΣΩ", "bold")).toBe("𝚨𝚸𝚺𝛀");
    expect(styledMathText("αω", "bold")).toBe("𝛂𝛚");
    expect(styledMathText("ϴ∇∂ϵϑϰϕϱϖ", "bold")).toBe("𝚹𝛁𝛛𝛜𝛝𝛞𝛟𝛠𝛡");
    expect(styledMathText("0189", "double-struck")).toBe("𝟘𝟙𝟠𝟡");
  });

  test("leaves a character no run covers as it was", () => {
    // Script has no digits and no Greek; nothing could have drawn them styled.
    expect(styledMathText("A1α+", "script")).toBe("𝒜1α+");
  });
});

describe("math failures", () => {
  test("fails the save and says where, rather than storing an merror", async () => {
    const result = await compileCarnapMarkdown(
      "Fine.\n\nBroken: $\\nosuchmacro x$ here.\n\nAlso $$ \\frac{1}{ $$\n",
    );

    expect(result.ok).toBe(false);

    if (result.ok) {
      return;
    }

    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics[0]).toMatchObject({
      code: "invalid_math",
      line: 3,
    });
    expect(result.diagnostics[0]?.params).toMatchObject({
      detail: "Undefined control sequence \\nosuchmacro",
    });
    expect(result.diagnostics[1]).toMatchObject({ line: 5 });
  });

  test("positions a failure inside an exercise prompt at its own line", async () => {
    const result = await compileCarnapMarkdown(
      [
        "Intro.",
        "",
        ":::multiple-choice{id=q1}",
        "Which one is $\\bogus$?",
        "",
        "- [x] a | First",
        "- [ ] b | Second, $\\alsobogus$",
        ":::",
      ].join("\n"),
    );

    expect(result.ok).toBe(false);

    if (result.ok) {
      return;
    }

    expect(result.diagnostics.map((entry) => entry.line)).toEqual([4, 7]);
  });
});

describe("math in a compiled document", () => {
  test("reaches prose, prompts, and option labels alike", async () => {
    const rendered = await compiledHtml(
      [
        "Prose with $\\Box\\varphi$.",
        "",
        ":::multiple-choice{id=q1}",
        "Which is $\\neg\\exists x\\,Fx$?",
        "",
        "- [x] a | The one with $\\forall$",
        "- [ ] b | Plain text",
        ":::",
      ].join("\n"),
    );

    expect(rendered).toContain("<math");
  });

  test("scopes a \\newcommand to the document that defines it", async () => {
    // A shared engine would let one author's macro resolve in the next
    // revision the same isolate compiles: works locally, fails in production.
    const defined = await compiledHtml(
      "$\\newcommand{\\Nec}{\\Box}$\n\nLater: $\\Nec p$\n",
    );

    expect(defined).toContain("◻");

    const next = await compileCarnapMarkdown("Later: $\\Nec p$\n");

    expect(next.ok).toBe(false);
  });
});

describe("the MathML the sanitizer allows", () => {
  test("keeps the presentation markup a formula needs", async () => {
    const rendered = await html("$$\\sqrt{x^2} \\quad \\binom{n}{k}$$");

    expect(rendered).toContain("<msqrt>");
    expect(rendered).toContain("<msup>");
    expect(rendered).toContain("<mspace");
    expect(rendered).toContain("<mfrac");
  });

  test("drops MathJax's own annotations rather than storing them", async () => {
    // `data-latex` is on every node MathJax builds, and nothing reads it.
    const rendered = await html("$x^2$");

    expect(rendered).not.toContain("data-latex");
    expect(rendered).not.toContain("data-mjx");
  });

  test("has no way to author an attribute that reaches HTML", async () => {
    // `\href`, `\class`, `\style` and `\cssId` all live in the `html` package,
    // which is not enabled — so these fail to compile rather than emitting
    // anything. The sanitizer is the second line, not the first.
    const result = await compileCarnapMarkdown(
      "$\\href{javascript:alert(1)}{x}$\n",
    );

    expect(result.ok).toBe(false);
  });
});

describe("the lines MathML Core dropped", () => {
  test("draws a table's rules with classes, and stops naming attributes", async () => {
    const rendered = await html(
      "$$\\begin{array}{c|c} a & b \\\\ \\hline c & d \\end{array}$$",
    );

    // Both halves matter: Firefox still honours `columnlines`, so a class that
    // arrived beside the attribute would draw every rule twice there.
    expect(rendered).not.toContain("columnlines");
    expect(rendered).not.toContain("rowlines");
    expect(rendered).toContain('class="math-ruled"');
    expect(rendered).toContain(
      '<mtd class="math-column-rule math-row-rule"><mi>a</mi></mtd>',
    );
    expect(rendered).toContain('<mtd class="math-row-rule"><mi>b</mi></mtd>');
    // Bottom row: the column rule stays, the row rule below it does not.
    expect(rendered).toContain(
      '<mtd class="math-column-rule"><mi>c</mi></mtd>',
    );
    expect(rendered).toContain("<mtd><mi>d</mi></mtd>");
  });

  test("does not rule the edge of a table whose rule list is one value", async () => {
    // `columnlines="solid"` covers *gaps*, and a two-column table has one. Read
    // as a per-column list — MathML repeats a list's last entry — it would draw
    // a rule down the right-hand edge that the author never wrote.
    const rendered = await html("$$\\begin{array}{c|c} a & b \\end{array}$$");

    expect(rendered).toContain(
      '<mtd class="math-column-rule"><mi>a</mi></mtd>',
    );
    expect(rendered).toContain("<mtd><mi>b</mi></mtd>");
  });

  test("keeps a frame and a leading rule as an enclosure around the table", async () => {
    const framed = await html("$$\\begin{array}{|c|} a \\end{array}$$");
    const ruled = await html("$$\\begin{array}{c} \\hline a \\end{array}$$");

    expect(framed).toContain(
      '<mrow class="math-enclose-left math-enclose-right">',
    );
    expect(ruled).toContain('<mrow class="math-enclose-top">');
  });

  test("turns an enclosure into an mrow, element and all", async () => {
    const boxed = await html("$\\boxed{x}$");

    // Not just the class: a `<menclose>` whose notation Firefox cannot read
    // draws a long-division sign, so the element itself has to go.
    expect(boxed).toContain('<mrow class="math-enclose-box">');
    expect(boxed).not.toContain("menclose");
    expect(boxed).not.toContain("notation");
  });

  test("draws both strikes of an \\xcancel on one row", async () => {
    expect(await html("$\\cancel{x}$")).toContain(
      '<mrow class="math-enclose-strike-up">',
    );
    expect(await html("$\\xcancel{x}$")).toContain(
      '<mrow class="math-enclose-strike-up math-enclose-strike-down">',
    );
  });

  test("refuses an enclosure it cannot draw rather than dropping it", async () => {
    // `\cancelto` wants an arrow, which no border or gradient draws. Failing
    // the save is what stops it being stored as a bare formula whose crossing
    // out has quietly vanished.
    const result = await compileCarnapMarkdown("$\\cancelto{0}{x}$\n");

    expect(result.ok).toBe(false);

    if (result.ok) {
      return;
    }

    expect(result.diagnostics[0]).toMatchObject({ code: "invalid_math" });
    expect(result.diagnostics[0]?.params).toMatchObject({
      detail:
        "the enclosure it asks for (updiagonalarrow) is not one a browser can draw",
    });
  });

  test("leaves column alignment to the attribute it cannot replace", async () => {
    // No CSS reaches an `<mtd>`'s alignment, so `columnalign` stays: Firefox
    // lines up an `aligned` environment, and Chromium centres it.
    expect(
      await html("$$\\begin{aligned} x &= 1 \\end{aligned}$$"),
    ).toContain('columnalign="right left"');
  });

  test("keeps the classes through a compiled document's sanitizer", async () => {
    const compiled = await compiledHtml(
      "$$\\begin{array}{|c|c|} a & b \\end{array}$$\n",
    );

    expect(compiled).toContain("math-enclose-left");
    expect(compiled).toContain("math-column-rule");
  });
});

describe("the editor's idea of a formula", () => {
  // Two parsers read the same source: `micromark-extension-math` decides what
  // the compiler typesets, and `@lezer/markdown` plus `carnapMath` decides what
  // the author is shown. A disagreement is an editor that colours a sentence
  // about money as mathematics, or leaves a real formula looking like prose.
  const CASES = [
    "A conditional $P \\to Q$ holds.",
    "Display: $$\\frac{a}{b}$$ inline.",
    "it cost $5 and then $10 in total",
    "padded $ x $ here",
    "escaped \\$5 and \\$10",
    "`echo $HOME` and $PATH stay",
    "unclosed $x and nothing after",
    "$a$ then $b$ twice",
    "empty $$ pair",
  ];

  /** The spans the editor highlights as math, as `[from, to]` pairs. */
  function editorMathSpans(source: string): [number, number][] {
    const state = EditorState.create({
      doc: source,
      extensions: [markdownLanguage],
    });
    const tree = ensureSyntaxTree(state, source.length, 5000);

    expect(tree).not.toBeNull();

    const spans: [number, number][] = [];

    tree?.iterate({
      enter(node) {
        if (node.name === "Math") {
          spans.push([node.from, node.to]);
        }
      },
    });

    return spans;
  }

  /** The same, from the compiler's own parse. */
  function compilerMathSpans(source: string): [number, number][] {
    const tree = markdownParser.parse(source) as Root;
    const spans: [number, number][] = [];
    const walk = (node: unknown): void => {
      const candidate = node as {
        readonly children?: readonly unknown[];
        readonly data?: { readonly carnapSource?: string };
        readonly position?: {
          readonly end: { readonly offset?: number };
          readonly start: { readonly offset?: number };
        };
        readonly type?: string;
      };

      if (
        candidate.type === "inlineMath" &&
        // The node exists whenever micromark matched dollars; whether it is a
        // formula is the dialect's own rule, and that is what to compare.
        inlineMathKind(candidate.data?.carnapSource ?? "") !== "literal"
      ) {
        spans.push([
          candidate.position?.start.offset ?? 0,
          candidate.position?.end.offset ?? 0,
        ]);
      }

      for (const child of candidate.children ?? []) {
        walk(child);
      }
    };

    walk(tree);

    return spans;
  }

  for (const source of CASES) {
    test(`agrees with the compiler on ${JSON.stringify(source)}`, () => {
      expect(editorMathSpans(source)).toEqual(compilerMathSpans(source));
    });
  }
});
