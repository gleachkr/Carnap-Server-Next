import { createMiddleware } from "hono/factory";

import type { AppBindings } from "../http";

/**
 * `nosniff`, named rather than spelled inline because it is the one of the
 * headers below that also has to hold for files the worker never sees. The
 * client bundles, the compiler's WASM and the math font are served by
 * Cloudflare's assets binding ahead of the worker — and by `serveStatic` ahead
 * of the app on the Bun host — so the middleware cannot reach them. The same
 * rule is therefore stated twice more, in the `public/_headers` written by
 * `scripts/copy-math-font.ts` and in `src/server/main.ts`, both from this
 * constant so the three spellings cannot drift.
 */
export const NOSNIFF_HEADER = {
  name: "X-Content-Type-Options",
  value: "nosniff",
} as const;

/**
 * The policy, one directive per entry so each can say why it reads as it does.
 *
 * What makes this affordable is that no page has an inline `<script>` any more:
 * every script is a file under our own origin, so `script-src 'self'` needs
 * neither a nonce (which would mean a per-request policy, and no caching of the
 * pages) nor a hash list (which would mean regenerating the policy on every
 * build). The only inline `<script>` elements left are
 * `type="application/json"` payloads, which are data blocks the browser never
 * prepares as script and so never checks.
 *
 * The policy divides where the risk does, not where the tidiness does. Anything
 * that can run — script, plugin, worker, base URL, framing — is first-party and
 * narrow. Passive resources an author might reference from a lesson — images,
 * stylesheets, the fonts those stylesheets ask for — are any `https` origin,
 * because refusing them would be refusing documented authoring features to buy
 * very little: with no injected script able to run, a third-party image is a
 * privacy question rather than a foothold, and an author who can already inline
 * CSS can do anything a linked sheet could.
 *
 * Two directives are absent on purpose, each because stating it would break
 * something the product does:
 *
 * - `form-action`, because the LTI deep-link return posts a form to the LMS's
 *   origin (`web/lti.tsx`), and that origin is per-platform and not known here.
 * - `frame-ancestors`, because an LTI launch is rendered inside the LMS's
 *   iframe. This is the same reason there is no `X-Frame-Options` above.
 */
const CONTENT_SECURITY_POLICY = [
  // The floor, for the fetch directives that have one: `media-src`,
  // `worker-src`, `manifest-src` and the rest collapse to this rather than
  // needing a line each. Note that `form-action` is *not* among them — it, like
  // `base-uri` and `frame-ancestors`, falls back to nothing, so leaving it out
  // below leaves form submission unrestricted rather than confined to `'self'`.
  // That is what keeps the LTI deep-link return working, and it is why omitting
  // the directive is a decision rather than an oversight.
  "default-src 'self'",
  // `wasm-unsafe-eval` is the Aufbau compiler: compiling WebAssembly counts as
  // evaluation, and without this the proof exercises cannot check anything in
  // the browser. It is far narrower than `unsafe-eval` — it permits WASM
  // compilation and nothing else, no `eval`, no `new Function`.
  "script-src 'self' 'wasm-unsafe-eval'",
  // `unsafe-inline` is structural rather than lazy: the content document inlines
  // whole stylesheets so a frame paints in one round trip, every exercise view
  // ships a `<style>` inside its declarative shadow root, and an author's own
  // CSS is inlined by definition. Closing it means giving each of those a URL,
  // which is its own piece of work.
  //
  // `https:` rather than a host list because `:::style{src=…}` is a documented
  // authoring feature, and the compiler has already decided which hrefs are
  // acceptable: `isValidStylesheetHref` takes an absolute `https` URL or a
  // site-relative path and refuses `http`, protocol-relative, and everything
  // else (`content/compiler.ts`). Naming hosts here would put the policy at odds
  // with the dialect — an author following the documentation would watch their
  // stylesheet be refused. This is that same rule, restated where the browser
  // can enforce it.
  "style-src 'self' 'unsafe-inline' https:",
  // Follows `style-src`, for a reason that only shows up in practice: a linked
  // stylesheet allowed to load will usually `@font-face` to the host it came
  // from, and permitting the sheet while refusing its fonts is the kind of
  // half-measure that yields a lesson set in fallback type and no obvious cause.
  "font-src 'self' https:",
  // `data:` is for the charity marks in `charity-icons.ts`, which are vendored
  // as data URLs precisely so the donate page fetches nothing from anyone.
  //
  // `https:` is for authors. Images are an active construct in Carnap markdown,
  // so a lesson embedding a diagram from elsewhere on the web is ordinary use,
  // not an attack, and a policy that refused it would be one the product has to
  // apologize for. `http:` stays out, matching the stylesheet rule — and a
  // browser would refuse it as mixed content on an https deployment anyway.
  "img-src 'self' data: https:",
  // Submissions, the UI-strings payloads and the compiler's WASM all come from
  // here. Nothing in Carnap talks to a third party from the browser.
  //
  // Notably this is *not* what an `src=` on `aufbau-mm0` would need. A theory is
  // frozen into the exercise's `publicData.mm0` at compile time and is the sole
  // input the worker verifies against, so a theory fetched by URL would be
  // fetched by us, once, on the server — where the control that matters is which
  // hosts the worker may call, not what a reader's browser may connect to.
  "connect-src 'self'",
  "object-src 'none'",
  // `'none'` rather than `'self'`, because nothing sets a base URL: the only
  // `<base>` Carnap emits is the content document's `<base target="_top">`,
  // which carries no `href` and so sets nothing for this to check. Confirmed in
  // a browser rather than assumed — the content frame and the editor's `srcdoc`
  // preview both report clean under it, and their links still resolve against
  // the document's own URL.
  "base-uri 'none'",
  // The content iframe, which is a page of ours. `srcdoc` previews are not
  // covered by this — a `srcdoc` frame inherits its parent's policy instead of
  // being fetched under one.
  "frame-src 'self'",
].join("; ");

/**
 * Enforcing. The policy shipped report-only first and was then walked through a
 * browser rather than reasoned about: every page reachable as a site admin, the
 * content iframe, the editor's `srcdoc` preview, a proof widget compiling the
 * Aufbau WASM in both realms, and — through a real Moodle — a core launch, a
 * launch embedded in the LMS's own iframe, and the deep-link return that posts a
 * form to the LMS's origin. Nothing was refused. The observation harness was
 * itself checked against a violation it was known to have, twice, because a
 * silent collector and a clean application look identical from here.
 *
 * There is no `report-uri`/`report-to`, by decision — a reporting endpoint is a
 * public, unauthenticated write surface, and the violations worth acting on
 * here are the ones visible while clicking through the app with the console
 * open, not the ones an extension generates in a stranger's browser. The cost
 * of that choice lands now: from here a violation is a broken page for the
 * reader who hits it, and we learn about it from them.
 */
const CSP_HEADER_NAME = "Content-Security-Policy";

/**
 * Four headers that each close a door we have no use for.
 *
 * `nosniff` stops a browser from second-guessing a `Content-Type`. It is what
 * holds the CSP above together, because the scripts are served from our own
 * origin under `script-src 'self'` — a policy that trusts the origin, not the
 * file. Anything we serve as data that a browser decides to read as script is
 * inside that trust; refusing to sniff is what keeps the two apart.
 *
 * `Referrer-Policy` keeps paths off the wire. A `Referer` sent to Google Fonts
 * or to an LMS otherwise names the assignment, the course, and the content
 * revision the reader was on. `strict-origin-when-cross-origin` is the modern
 * browser default; stating it is for the ones where it is not.
 *
 * `Permissions-Policy` denies camera, microphone and geolocation outright,
 * including to ourselves. Carnap asks for none of them, and the interesting
 * consequence is for the content iframe: an authored document that tried would
 * be refused by the policy the framing page carries.
 */
const SECURITY_HEADERS: readonly (readonly [string, string])[] = [
  [NOSNIFF_HEADER.name, NOSNIFF_HEADER.value],
  ["Referrer-Policy", "strict-origin-when-cross-origin"],
  ["Permissions-Policy", "camera=(), microphone=(), geolocation=()"],
  [CSP_HEADER_NAME, CONTENT_SECURITY_POLICY],
];

/**
 * Set the headers on the way out rather than on the way in, which is what makes
 * this cover every response rather than most of them. Handlers that build their
 * answer through the context (`c.html`, `c.json`) would pick up headers staged
 * before `next()`, but `redirect()` and the gradebook's CSV downloads return a
 * `Response` of their own — and a CSV is exactly the reply where `nosniff`
 * earns its place. Writing to the finished response catches those too, and
 * catches error and not-found pages, which are built after the handler that
 * failed has already returned.
 */
export function securityHeadersMiddleware() {
  return createMiddleware<AppBindings>(async (context, next) => {
    await next();

    for (const [name, value] of SECURITY_HEADERS) {
      context.res.headers.set(name, value);
    }
  });
}
