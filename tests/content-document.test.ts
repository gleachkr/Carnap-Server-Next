import { describe, expect, test } from "bun:test";
import { raw } from "hono/html";

import { passthroughTranslator } from "../src/worker/i18n/translator";
import {
  artifactStyleProps,
  contentDocumentHtml,
  escapeStyleText,
} from "../src/worker/web/content-document";
import { CONTENT_SCRIPT_ASSET } from "../src/worker/web/script-assets";
import {
  CHROME_STYLE_SHEET,
  CONTENT_STYLE_SHEET,
  lookupStyleSheet,
} from "../src/worker/web/style-assets";

/** Every document needs a translator and a language; these cases test neither. */
const DOCUMENT_LOCALE = {
  i18n: passthroughTranslator,
  locale: "en",
} as const;

describe("content document", () => {
  test("style text cannot break out of its style element", () => {
    const escaped = escapeStyleText(
      'p::after { content: "</style><script>alert(1)</script>"; }',
    );

    expect(escaped).not.toContain("</style>");
    expect(escaped).not.toContain("<script>");
    expect(escaped).toContain("\\3c ");
  });

  test("author css is a separate style element after the defaults", () => {
    const html = contentDocumentHtml({
      ...DOCUMENT_LOCALE,
      body: raw("<h1>Lesson</h1>"),
      css: "h1 { color: maroon; }",
      title: "Lesson",
    });

    expect(html.indexOf(".exercise-prompt")).toBeGreaterThan(-1);
    expect(html.indexOf("maroon")).toBeGreaterThan(
      html.indexOf(".exercise-prompt"),
    );
    expect(html).toContain("<h1>Lesson</h1>");
    expect(html).toContain(CONTENT_SCRIPT_ASSET.href);
    expect(html).not.toContain("app-header");
  });

  test("links escape only the frame we put the document in", () => {
    const framed = contentDocumentHtml({
      ...DOCUMENT_LOCALE,
      body: raw("<p>Prose.</p>"),
      escapeFrame: true,
      title: "Prose",
    });
    const framedReset = contentDocumentHtml({
      ...DOCUMENT_LOCALE,
      body: raw("<p>Prose.</p>"),
      cssReset: true,
      escapeFrame: true,
      title: "Prose",
    });
    const standalone = contentDocumentHtml({
      ...DOCUMENT_LOCALE,
      body: raw("<p>Prose.</p>"),
      title: "Prose",
    });

    // Inside our own frame `_top` is the page the reader is looking at, reset
    // or not — the base tag sits outside the stylesheet branch.
    expect(framed).toContain('<base target="_top"');
    expect(framedReset).toContain('<base target="_top"');
    // Anywhere else it is someone else's window: an LMS framing this document
    // would have its whole page replaced by a followed link.
    expect(standalone).not.toContain("<base");
  });

  test("a document without author css carries only the defaults", () => {
    const html = contentDocumentHtml({
      ...DOCUMENT_LOCALE,
      body: raw("<p>Prose.</p>"),
      title: "Prose",
    });

    // The shared layer and this document's own rules, and nothing after them.
    expect(html.split("<style>")).toHaveLength(3);
    expect(html).toContain(".exercise-prompt");
  });

  test("a served document links the shared layer instead of inlining it", () => {
    const html = contentDocumentHtml({
      ...DOCUMENT_LOCALE,
      baseStyleHrefs: [CONTENT_STYLE_SHEET.href],
      body: raw("<p>Prose.</p>"),
      css: "p { color: maroon; }",
      title: "Prose",
    });

    expect(html).toContain(`<link href="${CONTENT_STYLE_SHEET.href}"`);
    // The bytes themselves are gone; the document's own rules stay inline, and
    // author css still comes last so it wins ties against both.
    expect(html).not.toContain(".exercise-prompt");
    expect(html).toContain(".content-column");
    expect(html.indexOf("maroon")).toBeGreaterThan(
      html.indexOf(".content-column"),
    );
  });

  test("cssReset drops the default styles and font links", () => {
    const html = contentDocumentHtml({
      ...DOCUMENT_LOCALE,
      body: raw("<p>Prose.</p>"),
      css: "body { font-family: serif; }",
      cssReset: true,
      title: "Prose",
    });

    expect(html).not.toContain(".exercise-prompt");
    expect(html).not.toContain("fonts.googleapis.com");
    expect(html).toContain("font-family: serif;");
    // Linked even under reset: an author's own CSS does not mean their
    // exercises should stay inert or the frame stay unsized.
    expect(html).toContain(CONTENT_SCRIPT_ASSET.href);
  });

  test("stylesheet links sit between the defaults and the inline css", () => {
    const html = contentDocumentHtml({
      ...DOCUMENT_LOCALE,
      body: raw("<p>Prose.</p>"),
      css: "h1 { color: maroon; }",
      cssHrefs: ["https://styles.example.test/a.css", "/styles/slate.css"],
      title: "Prose",
    });
    const firstLink = html.indexOf(
      '<link href="https://styles.example.test/a.css" rel="stylesheet"',
    );
    const secondLink = html.indexOf(
      '<link href="/styles/slate.css" rel="stylesheet"',
    );

    expect(firstLink).toBeGreaterThan(html.indexOf(".exercise-prompt"));
    expect(secondLink).toBeGreaterThan(firstLink);
    expect(html.indexOf("maroon")).toBeGreaterThan(secondLink);
  });

  test("cssReset keeps the author's stylesheet links", () => {
    const html = contentDocumentHtml({
      ...DOCUMENT_LOCALE,
      body: raw("<p>Prose.</p>"),
      cssHrefs: ['/styles/slate.css?edition="dark"<v2>'],
      cssReset: true,
      title: "Prose",
    });

    expect(html).not.toContain(".exercise-prompt");
    // hono/jsx attribute encoding keeps a hostile href inside its attribute.
    expect(html).toContain(
      '<link href="/styles/slate.css?edition=&quot;dark&quot;&lt;v2&gt;" rel="stylesheet"',
    );
  });

  test("artifact style props guard loosely typed stored artifacts", () => {
    const base = {
      componentRegistryVersion: "component-registry-v1",
      document: { nodes: [], profile: "carnap-markdown-v1" as const },
      manifest: [],
      manifestVersion: 1 as const,
      sourceProfile: "carnap-markdown-v1" as const,
    };

    expect(artifactStyleProps(base)).toEqual({});
    expect(
      artifactStyleProps({ ...base, css: "h1 { color: maroon; }" }),
    ).toEqual({ css: "h1 { color: maroon; }" });
    expect(artifactStyleProps({ ...base, css: "", cssReset: true })).toEqual({
      cssReset: true,
    });
    expect(
      artifactStyleProps({ ...base, cssHrefs: ["", "/ok.css"] }),
    ).toEqual({ cssHrefs: ["/ok.css"] });
    expect(
      artifactStyleProps({
        ...base,
        cssHrefs: "/not-an-array.css" as unknown as readonly string[],
      }),
    ).toEqual({});
  });

  test("the shared layer carries the content rules and none of the chrome", () => {
    // What makes the split worth caching separately: the content document and
    // the shell ask for the same file, so the layer they share must hold
    // everything content needs — the custom properties above all, since the
    // chrome sheet the iframe never loads would take them with it.
    expect(CONTENT_STYLE_SHEET.css).toContain(":root");
    expect(CONTENT_STYLE_SHEET.css).toContain(".exercise-prompt");
    expect(CONTENT_STYLE_SHEET.css).not.toContain(".app-header");
    expect(CHROME_STYLE_SHEET.css).toContain(".app-header");
  });

  test("a stylesheet's URL follows its text", () => {
    // The hash is the whole cache story: it is what lets the response promise
    // a year, and it is derived rather than built so an edited rule cannot
    // ship under a URL a reader already has.
    for (const sheet of [CONTENT_STYLE_SHEET, CHROME_STYLE_SHEET]) {
      expect(sheet.href).toStartWith(`/styles/${sheet.name}.`);
      expect(sheet.href).toEndWith(".css");
      expect(lookupStyleSheet(sheet.href.slice("/styles/".length))).toEqual({
        asset: sheet,
        current: true,
      });
    }

    expect(CONTENT_STYLE_SHEET.href).not.toEqual(CHROME_STYLE_SHEET.href);

    // A superseded URL still names a real sheet, and gets the current one.
    const stale = lookupStyleSheet("content.000000.css");
    expect(stale?.asset).toBe(CONTENT_STYLE_SHEET);
    expect(stale?.current).toBe(false);

    expect(lookupStyleSheet("nonesuch.000000.css")).toBeNull();
  });
});
