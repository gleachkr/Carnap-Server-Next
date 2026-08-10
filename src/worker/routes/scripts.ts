import { Hono } from "hono";

import type { AppBindings } from "../http";
import {
  lookupScript,
  SCRIPT_CACHE_CONTROL,
  SCRIPT_ROUTE_PREFIX,
  STALE_SCRIPT_CACHE_CONTROL,
} from "../web/script-assets";

/**
 * The enhancement scripts, served from the worker rather than from `public/`
 * for the reasons `routes/styles.ts` gives about the stylesheets: the URL
 * carries a hash of the script itself, so there is no manifest to regenerate,
 * no committed build artifact to drift, and editing one in dev takes effect on
 * reload the way it did when the bytes were inlined.
 *
 * Mounted beside the stylesheets and ahead of the middleware. Nothing here
 * reads a session, a locale, or a token — a script is the same bytes for
 * everyone — so resolving an actor against the database to serve one would be a
 * query asked for nothing.
 */
export const scriptRoutes = new Hono<AppBindings>();

scriptRoutes.get(`${SCRIPT_ROUTE_PREFIX}:file`, (context) => {
  const found = lookupScript(context.req.param("file"));

  if (found === null) {
    return context.notFound();
  }

  return context.body(found.asset.js, 200, {
    "Cache-Control": found.current
      ? SCRIPT_CACHE_CONTROL
      : STALE_SCRIPT_CACHE_CONTROL,
    "Content-Type": "text/javascript; charset=utf-8",
    // The hash is already a digest of the body, so a revalidation of a
    // superseded URL costs a 304 rather than the file.
    ETag: `"${found.asset.href}"`,
  });
});
