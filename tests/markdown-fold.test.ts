import { describe, expect, test } from "bun:test";
import { ensureSyntaxTree, foldable } from "@codemirror/language";
import { EditorState } from "@codemirror/state";

import { markdownLanguage } from "../src/client/markdown-editor";
import { markdownParser } from "../src/worker/application/content/authoring-toolkit";
import { FORALLX_DEMO_SOURCE } from "./helpers/forallx-demo";
import { GENTZEN_DEMO_SOURCE } from "./helpers/gentzen-demo";
import { PRAWITZ_DEMO_SOURCE } from "./helpers/prawitz-demo";
import { SHOWCASE_DEMO_SOURCE } from "./helpers/showcase-demo";

/**
 * The source views' Markdown: which blocks fold, and whether the editor's idea of
 * a container directive is the compiler's.
 *
 * Two parsers read the same documents. `remark-directive` decides what the
 * compiler sees; `@lezer/markdown` plus `carnapDirectives` decides what the author
 * is shown — the highlighting, and the blocks the fold arrows offer to collapse.
 * Any disagreement between them is an editor that dresses up structure the
 * compiler will not honour, or hides structure it will, so the last test holds
 * the two together over a whole demo lesson.
 */

/** Force a complete parse; the fold ranges are read off the tree. */
function stateFor(doc: string): EditorState {
  const state = EditorState.create({ doc, extensions: [markdownLanguage] });

  expect(ensureSyntaxTree(state, doc.length, 5000)).not.toBeNull();

  return state;
}

/** The block a fold on `line` (1-based) collapses, as the lines it hides. */
function foldedLines(
  source: string,
  line: number,
): { first: number; last: number } | null {
  const state = stateFor(source);
  const opener = state.doc.line(line);
  const range = foldable(state, opener.from, opener.to);

  if (range === null) {
    return null;
  }

  // The opening line always stays visible: the fold starts at its end.
  expect(range.from).toBe(opener.to);

  return {
    first: state.doc.lineAt(range.from).number + 1,
    last: state.doc.lineAt(range.to).number,
  };
}

/** Every node name in the tree, in document order. */
function nodeNames(source: string): string[] {
  const state = stateFor(source);
  const names: string[] = [];

  ensureSyntaxTree(state, source.length, 5000)?.iterate({
    enter: (node) => {
      names.push(node.name);
    },
  });

  return names;
}

/** The lines that open a container directive, by each parser's reckoning. */
function directiveLines(source: string): {
  compiler: number[];
  editor: number[];
} {
  const state = stateFor(source);
  const editor: number[] = [];

  ensureSyntaxTree(state, source.length, 5000)?.iterate({
    enter: (node) => {
      if (node.name === "Directive") {
        editor.push(state.doc.lineAt(node.from).number);
      }
    },
  });

  const compiler: number[] = [];
  const visit = (node: unknown): void => {
    if (typeof node !== "object" || node === null) {
      return;
    }

    const { children, position, type } = node as {
      children?: readonly unknown[];
      position?: { start: { line: number } };
      type?: string;
    };

    if (type === "containerDirective" && position !== undefined) {
      compiler.push(position.start.line);
    }

    for (const child of children ?? []) {
      visit(child);
    }
  };

  visit(markdownParser.parse(source));

  return {
    compiler: compiler.sort((left, right) => left - right),
    editor: editor.sort((left, right) => left - right),
  };
}

describe("folding a container directive", () => {
  test("collapses the body and the closing fence", () => {
    const source = [
      "# Lesson",
      ':::aufbau-mm0{name="forallx" show}',
      "axiom ax (g: ctx) (a: wff): $ g , a ⊢ a $;",
      "axiom reit (g h: ctx) (a: wff): $ g ⊢ a $ > $ g , h ⊢ a $;",
      ":::",
      "After.",
    ].join("\n");

    expect(foldedLines(source, 2)).toEqual({ first: 3, last: 5 });
  });

  test("is not offered on a line that opens nothing", () => {
    const source = ["Prose.", ":::", ""].join("\n");

    expect(foldedLines(source, 1)).toBeNull();
    // A bare fence is a closer, not an opener — it has no name.
    expect(foldedLines(source, 2)).toBeNull();
  });

  test("is not offered while the block is still unterminated", () => {
    // The parser runs an unclosed directive to the end of the document, as
    // remark does; folding it would hide everything below the line being typed.
    const source = [':::aufbau-proof{id="p1"}', "Prove `a → a`.", ""].join(
      "\n",
    );

    expect(foldedLines(source, 1)).toBeNull();
  });

  test("a nested block's fence does not close the outer one", () => {
    const source = [
      "::::figure",
      ':::aufbau-mm0{name="prop"}',
      "axiom ax (g: ctx) (a: wff): $ g , a ⊢ a $;",
      ":::",
      "A caption.",
      "::::",
      "After.",
    ].join("\n");

    expect(foldedLines(source, 1)).toEqual({ first: 2, last: 6 });
    expect(foldedLines(source, 2)).toEqual({ first: 3, last: 4 });
  });

  test("a longer fence closes a shorter block", () => {
    // `remark-directive` asks only that the closer be at least as long as the
    // opener, so `::::` closes a `:::` block.
    const source = [":::note", "Careful.", "::::", ""].join("\n");

    expect(foldedLines(source, 1)).toEqual({ first: 2, last: 3 });
  });

  test("a directive opener inside a code fence opens nothing", () => {
    // What the authoring guide does: show the syntax rather than use it.
    const source = [
      "```markdown",
      ':::aufbau-mm0{name="forallx"}',
      "axiom ax (g: ctx) (a: wff): $ g , a ⊢ a $;",
      ":::",
      "```",
      "",
    ].join("\n");

    expect(foldedLines(source, 1)).toEqual({ first: 2, last: 5 });
    expect(foldedLines(source, 2)).toBeNull();
  });

  test("a closing fence inside a code fence still closes the block", () => {
    // Not what an author would expect, and not what it looks like — but it is
    // what the compiler does, because micromark checks for the closing fence at
    // the start of every line before the content is parsed at all. The
    // agreement test below is what pins this behaviour to remark's; folding to
    // any other line would tell the author their block reaches further than the
    // compiler will read it.
    const source = [
      ':::aufbau-proof-fitch{id="f1"}',
      "Write the proof. The directive looks like this:",
      "",
      "```markdown",
      ':::aufbau-mm0{name="forallx"}',
      ":::",
      "```",
      "",
      ":::",
      "After.",
    ].join("\n");

    expect(foldedLines(source, 1)).toEqual({ first: 2, last: 6 });
    expect(directiveLines(source)).toEqual({ compiler: [1], editor: [1] });
  });
});

describe("what the editor treats as a directive", () => {
  test("the body stays Markdown, and both fences are nodes of the block", () => {
    expect(
      nodeNames(
        [
          ':::aufbau-mm0{name="forallx"}',
          "Prose with *emphasis*.",
          ":::",
        ].join("\n"),
      ),
    ).toEqual([
      "Document",
      "Directive",
      "DirectiveMark",
      "DirectiveName",
      "DirectiveAttributes",
      "Paragraph",
      "Emphasis",
      "EmphasisMark",
      "EmphasisMark",
      "DirectiveMark",
    ]);
  });

  test("a directive can open straight after a line of prose", () => {
    expect(
      nodeNames(["Prose.", ":::note", "In the block.", ":::"].join("\n")),
    ).toEqual([
      "Document",
      "Paragraph",
      "Directive",
      "DirectiveMark",
      "DirectiveName",
      "Paragraph",
      "DirectiveMark",
    ]);
  });

  test("an opener is colons, a name, then attributes and nothing else", () => {
    const cases: readonly (readonly [string, boolean])[] = [
      [":::note", true],
      ["::::note", true],
      [':::aufbau-mm0{name="forallx" show}', true],
      [":::note[a label]", true],
      // Two colons is text.
      ["::note", false],
      // No name.
      [':::{name="forallx"}', false],
      // Prose after the opener.
      [":::note and more", false],
      // A name may not end in a dash.
      [":::note-", false],
    ];

    for (const [opener, isDirective] of cases) {
      const lines = directiveLines([opener, "Body.", ":::"].join("\n"));

      expect(lines.editor.includes(1), opener).toBe(isDirective);
      // And whatever the editor decided, the compiler decided too.
      expect(lines.editor, opener).toEqual(lines.compiler);
    }
  });

  const DEMOS = {
    forallx: FORALLX_DEMO_SOURCE,
    gentzen: GENTZEN_DEMO_SOURCE,
    prawitz: PRAWITZ_DEMO_SOURCE,
    showcase: SHOWCASE_DEMO_SOURCE,
  };

  for (const [name, source] of Object.entries(DEMOS)) {
    test(`editor and compiler find the same directives in the ${name} lesson`, () => {
      const { compiler, editor } = directiveLines(source);

      expect(editor.length).toBeGreaterThan(4);
      expect(editor).toEqual(compiler);
    });
  }
});
