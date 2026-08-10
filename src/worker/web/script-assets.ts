import { hashAssetText } from "./asset-hash";
import { EXERCISE_SCRIPT, REVIEW_SCRIPT } from "./assignment-scripts";
import { CONTENT_DOCUMENT_SCRIPT } from "./content-document-scripts";
import { SHELL_SCRIPT } from "./layout-scripts";

/**
 * The enhancement scripts as documents a browser can keep, rather than as bytes
 * repeated in every page — the same trade `style-assets.ts` makes, for the same
 * reason and by the same mechanism.
 *
 * Inlined, an assignment page carried about 25 KB of script that was identical
 * on every load and could never be cached, because the page around it is
 * per-reader and uncacheable by nature. Split out, each file is fetched once
 * and then not again: the URL carries a hash of the script's own text, which is
 * what lets the response say `immutable` honestly and what makes an edit
 * produce a different URL with no build step to remember.
 *
 * It is also what makes a Content-Security-Policy affordable. With nothing
 * executable left inline, `script-src 'self'` needs neither per-request nonces
 * nor a table of hashes kept in step with the source.
 *
 * The split is by document, not by concern. Every page loads {@link SHELL},
 * content documents load {@link CONTENT}, and the two assignment views load one
 * each — because a student answering exercises and an instructor reviewing them
 * are different pages, and shipping each the other's code would be a request
 * neither of them can use.
 */
export interface ScriptAsset {
  /** Absolute so it resolves the same from a page, an iframe, or a `srcdoc`. */
  readonly href: string;
  readonly js: string;
  /** The stable part of the filename, before the hash. */
  readonly name: string;
}

/** Every script URL lives under here, which is what the route matches on. */
export const SCRIPT_ROUTE_PREFIX = "/scripts/";

function scriptAsset(name: string, js: string): ScriptAsset {
  return {
    href: `${SCRIPT_ROUTE_PREFIX}${name}.${hashAssetText(js)}.js`,
    js,
    name,
  };
}

/** Dialogs, content frames, timestamps, timezones, clipboard: every page. */
export const SHELL_SCRIPT_ASSET = scriptAsset("shell", SHELL_SCRIPT);

/** Component loading and height reporting: the content document. */
export const CONTENT_SCRIPT_ASSET = scriptAsset(
  "content",
  CONTENT_DOCUMENT_SCRIPT,
);

/** The exercise runtime: the assignment page a student answers on. */
export const EXERCISE_SCRIPT_ASSET = scriptAsset(
  "exercises",
  EXERCISE_SCRIPT,
);

/** Review actions: the page an instructor grades on. */
export const REVIEW_SCRIPT_ASSET = scriptAsset("review", REVIEW_SCRIPT);

const BY_NAME = new Map(
  [
    SHELL_SCRIPT_ASSET,
    CONTENT_SCRIPT_ASSET,
    EXERCISE_SCRIPT_ASSET,
    REVIEW_SCRIPT_ASSET,
  ].map((script) => [script.name, script]),
);

/** A year, because the hash in the URL is a promise this file will not move. */
export const SCRIPT_CACHE_CONTROL = "public, max-age=31536000, immutable";

/**
 * What a superseded URL gets, for the reason `style-assets.ts` spells out:
 * pages are uncacheable but not unstored, so a reader can arrive at markup from
 * the deploy before this one. A page whose dialogs and timestamps had stopped
 * working would be a far worse answer than the current script under an old
 * name, so the name alone decides what is served and only the hash decides how
 * long it may be kept.
 */
export const STALE_SCRIPT_CACHE_CONTROL =
  "public, max-age=0, must-revalidate";

export interface ScriptLookup {
  readonly asset: ScriptAsset;
  /** The requested filename is the one this text hashes to. */
  readonly current: boolean;
}

/**
 * Resolves a request under {@link SCRIPT_ROUTE_PREFIX}. The filename is
 * `<name>.<hash>.js`; an unknown name is the only miss.
 */
export function lookupScript(fileName: string): ScriptLookup | null {
  const [name] = fileName.split(".");
  const asset = name === undefined ? undefined : BY_NAME.get(name);

  if (asset === undefined) {
    return null;
  }

  return {
    asset,
    current: `${SCRIPT_ROUTE_PREFIX}${fileName}` === asset.href,
  };
}
