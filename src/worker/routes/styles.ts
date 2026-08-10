import { Hono } from "hono";

import type { AppBindings } from "../http";
import {
  lookupStyleSheet,
  STALE_STYLE_CACHE_CONTROL,
  STYLE_CACHE_CONTROL,
  STYLE_ROUTE_PREFIX,
} from "../web/style-assets";

/**
 * The shell's stylesheets, served from the worker rather than from `public/`
 * because the URL carries a hash of the CSS itself: there is no manifest to
 * regenerate, no committed build artifact to drift, and editing a rule in dev
 * takes effect on reload the way it did when the bytes were inlined.
 *
 * Its own module because of where it is mounted — ahead of the middleware, in
 * `createApp` — and a route that must stay in front of something is easier to
 * keep there when it is not sitting in the middle of a file about pages.
 * Nothing here reads a session, a locale, or a token: a stylesheet is the same
 * bytes for everyone, and it is on the critical path for the first paint.
 */
export const styleRoutes = new Hono<AppBindings>();

styleRoutes.get(`${STYLE_ROUTE_PREFIX}:file`, (context) => {
  const found = lookupStyleSheet(context.req.param("file"));

  if (found === null) {
    return context.notFound();
  }

  return context.body(found.asset.css, 200, {
    "Cache-Control": found.current
      ? STYLE_CACHE_CONTROL
      : STALE_STYLE_CACHE_CONTROL,
    "Content-Type": "text/css; charset=utf-8",
    // The hash is already a digest of the body, so a revalidation of a
    // superseded URL costs a 304 rather than the file.
    ETag: `"${found.asset.href}"`,
  });
});
