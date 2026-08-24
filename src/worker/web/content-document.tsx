import type { Context } from "hono";
import { raw } from "hono/html";
import type { Child } from "hono/jsx";
import type { CompiledContentArtifact } from "../domain/content";
import type { ExerciseHydration } from "../exercises/hydration";
import type { Translator } from "../i18n/translator";
import contentDocumentStyles from "./content-document.css" with {
  type: "text",
};
import { I18nProvider } from "./i18n-context";
import { jsonScriptContent } from "./json-script";
import { CONTENT_SCRIPT_ASSET } from "./script-assets";
import { CONTENT_STYLE_SHEET } from "./style-assets";
import { CONTENT_STYLES } from "./styles";

/**
 * The standalone content document: compiled markdown and exercise forms as a
 * complete HTML page with no app chrome. It is served into the content
 * iframes on the assignment and revision pages and opened directly by their
 * fullscreen links. The iframe is the isolation boundary that lets author
 * CSS restyle content freely without touching the app shell — and keeps the
 * shell's styles from fighting the author's.
 */
/**
 * Query marker meaning "this request is for the body of one of our own content
 * frames", added by `ContentFrame` to its iframe `src` and by nothing else. It
 * is the only thing that distinguishes our frame from anyone else's — the
 * document has the same URL either way — and what it buys is `escapeFrame`
 * below.
 */
export const APP_FRAME_PARAM = "appframe";

export interface ContentDocumentModel {
  /**
   * The default content styles as cacheable stylesheets — what a document
   * served over HTTP wants, since the shell above it has already fetched the
   * same file. Omitted, the styles are inlined instead, which is what the
   * revision editor's preview needs: it builds this document in the browser
   * into a `srcdoc` frame, and a preview that had to wait on a request would
   * flash unstyled on every keystroke.
   */
  readonly baseStyleHrefs?: readonly string[];
  readonly body: Child;
  /**
   * The component bundles this document's exercises need. Non-empty means the
   * document emits the asset list and the loader that pulls one ES module per
   * id, so the server-rendered custom elements upgrade. Every document with
   * exercises wants this — interactive or preview — because Carnap's exercises
   * are inert until their element upgrades.
   */
  readonly componentAssets?: readonly string[];
  /** Author stylesheet, appended after the defaults so it wins ties. */
  readonly css?: string;
  /** External author stylesheets, linked after the defaults and before `css`. */
  readonly cssHrefs?: readonly string[];
  /** Omit the default content styles entirely (`:::style{reset}`). */
  readonly cssReset?: boolean;
  /**
   * Break out of the surrounding frame when a link is followed. True only when
   * the frame is ours (see `APP_FRAME_PARAM`): there a link left to itself
   * would load the target page — app chrome and all — inside a card-sized
   * frame, and `_top` is the page the reader is already looking at.
   *
   * It must stay false everywhere else. An LMS launch frames this document
   * directly, so there `_top` is the LMS's own window: a followed link would
   * replace the whole LMS page and leave the student outside it.
   */
  readonly escapeFrame?: boolean;
  /**
   * Hydration payloads keyed by exercise id — the preview channel (see
   * `exerciseHydrationForArtifact`). Omitted on the interactive path, where each
   * submission form carries its own per-element payload.
   */
  readonly exerciseHydration?: Record<string, ExerciseHydration>;
  /**
   * The viewer's translator, provided to the document's own components (the
   * exercise forms reach for it). A `Translator` rather than the real i18n
   * module because this file is compiled into the browser preview bundle; that
   * path passes a `payloadTranslator` over strings the server resolved, so a
   * rebuilt preview stays in the same language `locale` claims.
   */
  readonly i18n: Translator;
  /** BCP 47 tag for the document root, matching `i18n`. */
  readonly locale: string;
  readonly title: string;
}

/**
 * Escape CSS for inline `<style>` embedding: every `<` becomes the CSS hex
 * escape `\3c ` (the trailing space terminates the escape), so author CSS can
 * never break out of the style element. The escape is valid anywhere CSS text
 * occurs; a literal `<` outside a string was invalid CSS anyway.
 */
export function escapeStyleText(css: string): string {
  return css.replaceAll("<", "\\3c ");
}

/**
 * The style-related document props carried by a compiled artifact, guarded at
 * runtime because stored artifacts are lenient casts of persisted JSON.
 */
export function artifactStyleProps(artifact: CompiledContentArtifact): {
  css?: string;
  cssHrefs?: readonly string[];
  cssReset?: boolean;
} {
  const cssHrefs = Array.isArray(artifact.cssHrefs)
    ? artifact.cssHrefs.filter(
        (href): href is string => typeof href === "string" && href.length > 0,
      )
    : [];

  return {
    ...(typeof artifact.css === "string" && artifact.css.length > 0
      ? { css: artifact.css }
      : {}),
    ...(cssHrefs.length === 0 ? {} : { cssHrefs }),
    ...(artifact.cssReset === true ? { cssReset: true } : {}),
  };
}

const CONTENT_DOCUMENT_STYLES = contentDocumentStyles;

export function contentDocumentHtml(model: ContentDocumentModel): string {
  const node = (
    <I18nProvider i18n={model.i18n}>
      <html lang={model.locale}>
        <head>
          <meta charset="utf-8" />
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1"
          />
          {/* Only inside our own frame, and never inside an LMS's: see
            `escapeFrame`. Exercise submissions are unaffected either way (the
            runtime uses fetch). */}
          {model.escapeFrame === true ? <base target="_top" /> : null}
          <title>{model.title}</title>
          {model.cssReset === true ? null : (
            <>
              {model.baseStyleHrefs === undefined ? (
                <style>{raw(CONTENT_STYLES)}</style>
              ) : (
                model.baseStyleHrefs.map((href) => (
                  <link href={href} rel="stylesheet" />
                ))
              )}
              {/* Stays inline either way: it is a page's worth of rules, only
                  this document ever wants them, and inside an iframe a second
                  request is a second round trip before anything paints. */}
              <style>{raw(CONTENT_DOCUMENT_STYLES)}</style>
            </>
          )}
          {(model.cssHrefs ?? []).map((href) => (
            <link href={href} rel="stylesheet" />
          ))}
          {model.css === undefined ? null : (
            <style>{raw(escapeStyleText(model.css))}</style>
          )}
          {/* Outside the `cssReset` branch: an author who supplied their own
              stylesheet still wants their exercises to load and the frame to be
              sized. `defer` puts execution after the payloads at the foot of
              the body, which is where the loader reads its asset list. */}
          <script defer src={CONTENT_SCRIPT_ASSET.href} />
        </head>
        <body>
          {/* Layout scaffolding only: it holds the reading to a page's measure
            when this document is opened on its own. */}
          <div class="content-column">
            <noscript>
              <p class="content-noscript">
                {model.i18n.t(
                  "This exercise needs JavaScript enabled to load. Please turn it on for this site.",
                )}
              </p>
            </noscript>
            {model.body}
          </div>
          {(model.componentAssets ?? []).length === 0 ? null : (
            <>
              <script type="application/json" data-carnap-component-assets>
                {raw(jsonScriptContent(model.componentAssets))}
              </script>
              {model.exerciseHydration === undefined ? null : (
                <script type="application/json" data-exercise-hydration-map>
                  {raw(jsonScriptContent(model.exerciseHydration))}
                </script>
              )}
            </>
          )}
        </body>
      </html>
    </I18nProvider>
  );
  const rendered = node.toString();

  if (typeof rendered !== "string") {
    // All content-document components are synchronous, so this should be
    // unreachable.
    throw new Error("Content document rendered asynchronously.");
  }

  return `<!doctype html>${rendered}`;
}

// A bare Context rather than Context<AppBindings>: this module is shared with
// the client preview bundle, and the bindings type would drag worker-only
// globals into the browser typecheck.
export function renderContentDocument(
  context: Context,
  model: Omit<ContentDocumentModel, "i18n" | "locale">,
): Response {
  return context.html(
    contentDocumentHtml({
      // Every document that travels over the wire links its styles; only the
      // in-browser preview, which never comes through here, inlines them.
      baseStyleHrefs: [CONTENT_STYLE_SHEET.href],
      // Asked once here rather than in each of the three routes that serve a
      // content document: whether we are the framer is a property of the
      // request, not of what is being rendered.
      escapeFrame: new URL(context.req.url).searchParams.has(APP_FRAME_PARAM),
      ...model,
      i18n: context.get("i18n"),
      locale: context.get("language"),
    }),
  );
}
