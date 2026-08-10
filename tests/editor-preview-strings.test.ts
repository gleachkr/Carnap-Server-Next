import { describe, expect, test } from "bun:test";
import { raw } from "hono/html";

import { compileCarnapMarkdown } from "../src/worker/application/content/compiler";
import {
  componentAssetsForArtifact,
  exerciseHydrationForArtifact,
  renderCompiledContent,
} from "../src/worker/application/content/renderer";
import type { CompiledContentArtifact } from "../src/worker/domain/content";
import {
  EXERCISE_STRING_ASSET_IDS,
  exerciseStrings,
} from "../src/worker/exercises/strings";
import { DEFAULT_LOCALE, i18nFor } from "../src/worker/i18n";
import type { Translator } from "../src/worker/i18n/translator";
import { contentDocumentHtml } from "../src/worker/web/content-document";
import {
  editorUiStrings,
  payloadTranslator,
} from "../src/worker/web/ui-strings";

/**
 * The revision editor's live preview, rebuilt in the browser.
 *
 * The server renders the first `srcdoc` with the real catalog; the preview
 * bundle then rebuilds that same document on every keystroke, in a browser that
 * has no catalog and must not be given one. It used to rebuild it through
 * `passthroughTranslator`, so a German author's first keystroke turned every
 * widget label and the `<noscript>` sentence English while the document went on
 * declaring `lang="de"` — inconsistent prose *and* a WCAG 3.1.1 failure, and
 * invisible to the pseudolocale gate, which only ever exercises the server render.
 *
 * These tests stand in for that bundle: `src/client/editor-preview.ts` is a DOM
 * entry point that cannot be imported here, so they drive the two functions it
 * calls — `editorUiStrings` (server, writes the payload) and `payloadTranslator`
 * (browser, reads it) — through the same render the bundle performs. The last
 * test pins that the bundle really does use them.
 */

const TRUTH_TABLE_SOURCE = "::::truth-table{#tt1 points=1}\n- (P -> P)\n::::";

const NOSCRIPT_ID =
  "This exercise needs JavaScript enabled to load. Please turn it on for this site.";

async function compile(source: string): Promise<CompiledContentArtifact> {
  const compiled = await compileCarnapMarkdown(source);

  if (!compiled.ok) {
    throw new Error(
      `compile failed: ${compiled.diagnostics.map((d) => d.code).join(", ")}`,
    );
  }

  return compiled.artifact;
}

/** The payload the editor page emits for `locale`, and the browser's reader. */
function previewFor(locale: string): {
  readonly i18n: Translator;
  readonly locale: string;
  readonly strings: Readonly<Record<string, string>>;
} {
  const { preview } = editorUiStrings(i18nFor(locale), locale);

  return {
    i18n: payloadTranslator(preview.strings, preview.locale),
    locale: preview.locale,
    strings: preview.strings,
  };
}

/** What `setUpPreview` assigns to the iframe's `srcdoc` after an edit. */
function rebuild(locale: string, artifact: CompiledContentArtifact): string {
  const preview = previewFor(locale);

  return contentDocumentHtml({
    body: raw(renderCompiledContent(artifact, i18nFor("en"))),
    componentAssets: componentAssetsForArtifact(artifact),
    exerciseHydration: exerciseHydrationForArtifact(artifact, preview.i18n),
    i18n: preview.i18n,
    locale: preview.locale,
    title: "Vorschau",
  });
}

describe("browser rebuild of the preview document", () => {
  test("words a widget in the page's language, not the source English", async () => {
    const artifact = await compile(TRUTH_TABLE_SOURCE);
    const hydration = exerciseHydrationForArtifact(
      artifact,
      previewFor("de").i18n,
    );

    // The label the author sees on the button, through the map the server sent
    // rather than through the id. `passthroughTranslator` gives "Check".
    expect(hydration.tt1?.strings.Check).toBe("Prüfen");
    expect(hydration.tt1?.strings["Find counterexample"]).toBe(
      "Gegenbeispiel finden",
    );
  });

  test("resolves every widget string exactly as the server would", () => {
    for (const locale of [DEFAULT_LOCALE, "de"]) {
      const preview = previewFor(locale);

      for (const assetId of EXERCISE_STRING_ASSET_IDS) {
        expect(
          exerciseStrings(assetId, preview.i18n),
          `${assetId} in ${locale}`,
        ).toEqual(exerciseStrings(assetId, i18nFor(locale)));
      }
    }
  });

  test("declares the language it is actually written in", async () => {
    const artifact = await compile(TRUTH_TABLE_SOURCE);
    const german = rebuild("de", artifact);

    expect(german).toContain('lang="de"');
    // The document's own prose, not just the widgets'.
    expect(german).toContain("Diese Übung benötigt aktiviertes JavaScript.");

    const english = rebuild(DEFAULT_LOCALE, artifact);

    expect(english).toContain(`lang="${DEFAULT_LOCALE}"`);
    expect(english).toContain(NOSCRIPT_ID);
  });

  /**
   * The one sentence `contentDocumentHtml` words itself is listed a second time
   * in `ui-strings.ts`, because a payload has to be built before anything is
   * rendered. Both call sites share one catalog id, so this fails the moment
   * they drift — or the moment the document grows a sentence nobody shipped.
   */
  test("covers every message the content document asks for", () => {
    const preview = previewFor("de");
    const catalog = i18nFor("de");
    const asked: string[] = [];

    contentDocumentHtml({
      body: "",
      i18n: {
        locale: catalog.locale,
        t: (id, values, options) => {
          asked.push(id);

          return catalog.t(id, values, options);
        },
      },
      locale: "de",
      title: "Vorschau",
    });

    expect(asked).toContain(NOSCRIPT_ID);

    for (const id of asked) {
      expect(preview.i18n.t(id), `preview payload is missing ${id}`).toBe(
        catalog.t(id),
      );
    }
  });
});

describe("editor strings payload", () => {
  /**
   * The payload is a lookup with an English fallback on the reading side, so an
   * entry that resolves to its own source text says nothing. In English that is
   * every entry — and shipping them anyway cost 9.2 KB on every English editor
   * page. The ratchet is deliberately loose; the point is that it can never
   * grow back to a copy of the catalog.
   */
  test("carries nothing an English page can work out for itself", () => {
    const strings = editorUiStrings(i18nFor(DEFAULT_LOCALE), DEFAULT_LOCALE);

    expect(strings.diagnostics).toEqual({});
    expect(strings.preview.strings).toEqual({});
    expect(JSON.stringify(strings).length).toBeLessThan(1000);
  });

  // ...which is only safe because the fallback is the id, and every id is its
  // own English text. Both halves of the editor must still read as English.
  test("still renders English, from the ids alone", async () => {
    const artifact = await compile(TRUTH_TABLE_SOURCE);
    const preview = previewFor(DEFAULT_LOCALE);
    const hydration = exerciseHydrationForArtifact(artifact, preview.i18n);

    expect(preview.strings).toEqual({});
    expect(hydration.tt1?.strings.Check).toBe("Check");
    expect(hydration.tt1?.strings.Correct).toBe("Correct");
    expect(rebuild(DEFAULT_LOCALE, artifact)).toContain(NOSCRIPT_ID);
  });

  test("a translated locale ships only what it translated", () => {
    const german = editorUiStrings(i18nFor("de"), "de");

    expect(german.preview.locale).toBe("de");
    expect(german.preview.strings.Check).toBe("Prüfen");
    // The disambiguated ids too: their fallback is the display text, so the
    // browser needs the entry under the id it will actually ask by.
    expect(german.preview.strings["Correct (truth-table cell)"]).toBe(
      "Richtig",
    );
  });
});

/**
 * The bundle itself, checked at the source level: everything above proves the
 * mechanism works, not that the browser uses it. `editor-preview.ts` runs DOM
 * queries at module scope, so importing it here is not an option.
 */
describe("src/client/editor-preview.ts", () => {
  test("renders the preview through the payload, not a passthrough", async () => {
    const source = await Bun.file(
      new URL("../src/client/editor-preview.ts", import.meta.url),
    ).text();
    // Matched as imports and calls rather than as words, so the prose that
    // explains the fix cannot satisfy — or break — the test.
    const imported = (name: string): boolean =>
      new RegExp(String.raw`import\s*\{[^}]*\b${name}\b[^}]*\}`, "s").test(
        source,
      );

    expect(imported("payloadTranslator"), "reads the payload").toBe(true);
    expect(imported("passthroughTranslator"), "renders English").toBe(false);
    // The locale must come from the strings actually rendered, not from the
    // outer page's `lang`: two channels, and they were free to disagree.
    expect(source.includes("documentElement.lang"), "reads lang").toBe(false);
  });
});
