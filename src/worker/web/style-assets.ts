import { hashAssetText } from "./asset-hash";
import { CHROME_STYLES, CONTENT_STYLES } from "./styles";

/**
 * The stylesheets as documents a browser can keep, rather than as bytes
 * repeated in every page.
 *
 * Inlined, the shell's CSS was four fifths of every gzipped HTML response and
 * could never be cached, because the pages carrying it are per-reader and
 * uncacheable by nature — so a student walking a course paid for it again at
 * every hop. Split out, it is fetched once and then not again: the URL carries
 * a hash of the file's own text, which is what lets the response say
 * `immutable` honestly and what makes a deploy that changes a rule produce a
 * different URL with no build step to remember.
 *
 * The two layers stay two files. A lesson is two documents — the app shell and
 * the content iframe — and both want CONTENT_STYLES, so keeping it separate
 * from the shell-only chrome means the iframe's copy is the shell's copy,
 * already in the cache.
 */
export interface StyleSheetAsset {
  readonly css: string;
  /** Absolute so it resolves the same from a page, an iframe, or a `srcdoc`. */
  readonly href: string;
  /** The stable part of the filename, before the hash. */
  readonly name: string;
}

/** Every stylesheet URL lives under here, which is what the route matches on. */
export const STYLE_ROUTE_PREFIX = "/styles/";

function styleSheetAsset(name: string, css: string): StyleSheetAsset {
  return {
    css,
    href: `${STYLE_ROUTE_PREFIX}${name}.${hashAssetText(css)}.css`,
    name,
  };
}

/** Authored content and exercise forms: the shell and the content document. */
export const CONTENT_STYLE_SHEET = styleSheetAsset("content", CONTENT_STYLES);

/** Navigation, sheets, ledgers, dialogs: the app shell alone. */
export const CHROME_STYLE_SHEET = styleSheetAsset("chrome", CHROME_STYLES);

const BY_NAME = new Map(
  [CONTENT_STYLE_SHEET, CHROME_STYLE_SHEET].map((sheet) => [
    sheet.name,
    sheet,
  ]),
);

/** A year, because the hash in the URL is a promise this file will not move. */
export const STYLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

/**
 * What a superseded URL gets. Pages are uncacheable but not unstored — a reader
 * can arrive at markup from the deploy before this one — and an unstyled page
 * is a far worse answer than the current stylesheet under an old name. So the
 * name alone decides what is served, and only the hash decides how long it may
 * be kept: mismatched, it is somebody else's bytes and must be re-asked for.
 */
export const STALE_STYLE_CACHE_CONTROL = "public, max-age=0, must-revalidate";

export interface StyleSheetLookup {
  readonly asset: StyleSheetAsset;
  /** The requested filename is the one this text hashes to. */
  readonly current: boolean;
}

/**
 * Resolves a request under {@link STYLE_ROUTE_PREFIX}. The filename is
 * `<name>.<hash>.css`; an unknown name is the only miss.
 */
export function lookupStyleSheet(fileName: string): StyleSheetLookup | null {
  const [name] = fileName.split(".");
  const asset = name === undefined ? undefined : BY_NAME.get(name);

  if (asset === undefined) {
    return null;
  }

  return {
    asset,
    current: `${STYLE_ROUTE_PREFIX}${fileName}` === asset.href,
  };
}
