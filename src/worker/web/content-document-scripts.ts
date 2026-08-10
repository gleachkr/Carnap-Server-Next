/**
 * The content document's own two scripts, split out of `content-document.tsx`
 * so {@link ./script-assets} can build a file from them without importing the
 * module that renders the markup. See `layout-scripts.ts` for the same split.
 *
 * Both are loaded `defer`, so the JSON payloads at the end of the body are
 * parsed before either runs.
 */

/**
 * Loads the interactive component bundles a document actually uses: one ES
 * module per asset id from `/assets/components/<assetId>.js`, each of which
 * self-registers its custom element, which then upgrades the matching tags the
 * server rendered. Relative so it resolves for both a real document route and
 * the editor's `srcdoc` preview (which inherits the parent's base URL).
 */
const COMPONENT_LOADER_SCRIPT = `
(() => {
  const source = document.querySelector("[data-carnap-component-assets]");
  if (source === null) {
    return;
  }

  let assetIds;
  try {
    assetIds = JSON.parse(source.textContent || "[]");
  } catch (_error) {
    return;
  }

  if (!Array.isArray(assetIds)) {
    return;
  }

  for (const assetId of assetIds) {
    if (typeof assetId !== "string" || assetId.length === 0) {
      continue;
    }

    const script = document.createElement("script");
    script.type = "module";
    script.src = "/assets/components/" + encodeURIComponent(assetId) + ".js";
    document.head.appendChild(script);
  }
})();
`;

const CONTENT_RESIZE_SCRIPT = `
(() => {
  if (window.parent === window) {
    return;
  }

  const post = () => {
    // targetOrigin "*" is load-bearing: srcdoc documents (the revision
    // editor preview) have origin "null", so naming our own origin would
    // never deliver. The payload is an inert height; the parent validates
    // event.origin and event.source before acting on it.
    window.parent.postMessage(
      {
        height: document.documentElement.scrollHeight,
        type: "carnap:content-height",
      },
      "*",
    );
  };

  new ResizeObserver(post).observe(document.documentElement);
  window.addEventListener("load", post);
  post();
})();
`;

/**
 * Both scripts, always served together. The loader returns immediately when a
 * document has no component payload, so a document with no exercises pays for
 * one cached request and nothing else — and every content document then asks
 * for the same URL, which is what keeps it in the cache.
 */
export const CONTENT_DOCUMENT_SCRIPT = [
  COMPONENT_LOADER_SCRIPT,
  CONTENT_RESIZE_SCRIPT,
].join("\n");
