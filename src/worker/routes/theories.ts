import { Hono } from "hono";

import type { AppBindings } from "../http";
import {
  THEORY_ROUTE_PREFIX,
  theorySourceByFileName,
} from "../logic/theories";
import { hashAssetText } from "../web/asset-hash";

/**
 * The built-in proof theories, at the paths authored content names them by.
 *
 * Serving them is what makes the path an honest address rather than an id
 * dressed as one: an author who writes `src="/theories/forallx-calgary-2019.mm0"`
 * can open it and read the rules, the axiom names their proofs will cite, and
 * the commentary shipped alongside. The compiler still resolves from the module
 * graph — this route is for people.
 *
 * Mounted with the stylesheets and scripts, ahead of the middleware, for their
 * reason: a theory is the same bytes for everyone, so resolving a session
 * against the database to serve one is a query asked for nothing. Unlike those,
 * the URL carries no hash of its own text — content quotes these paths, so they
 * have to survive a deploy that fixes a typo in a comment. The ETag does that
 * job instead, and revalidation costs a 304.
 */
export const theoryRoutes = new Hono<AppBindings>();

/** An hour, then ask again. The ETag makes the asking cheap. */
const THEORY_CACHE_CONTROL = "public, max-age=3600, must-revalidate";

theoryRoutes.get(`${THEORY_ROUTE_PREFIX}:file`, (context) => {
  const source = theorySourceByFileName(context.req.param("file"));

  if (source === null) {
    return context.notFound();
  }

  return context.body(source, 200, {
    "Cache-Control": THEORY_CACHE_CONTROL,
    // Plain text, not a download: the point is to be readable in a tab. MM0 has
    // no registered media type, and inventing one here would only invite a
    // browser to guess about it.
    "Content-Type": "text/plain; charset=utf-8",
    ETag: `"${hashAssetText(source)}"`,
  });
});
