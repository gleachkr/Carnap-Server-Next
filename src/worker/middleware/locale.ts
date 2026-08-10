import type { Context, MiddlewareHandler } from "hono";
import type { DetectorType } from "hono/language";
import { languageDetector } from "hono/language";
import { LOCALE_COOKIE_NAME } from "../cookies";
import type { AppBindings } from "../http";
import {
  DEFAULT_LOCALE,
  i18nFor,
  isSupportedLocale,
  PSEUDO_LOCALE,
  SUPPORTED_LOCALES,
} from "../i18n";

/**
 * Phase one of locale resolution: what the request itself asks for.
 *
 * `order` deliberately excludes `querystring` and `path`. An LTI launch arrives
 * with platform-controlled parameters, and honouring `?lang=` would let any link
 * silently repin a reader's language; `lookupFromPathIndex` would read the
 * leading `courses` of every URL as a language tag.
 *
 * `caches: false` because the middleware's own cookie writer fires whenever
 * detection *succeeds* — including from a sniffed `Accept-Language` — which
 * would pin a guess as though it were a choice and make the two
 * indistinguishable afterwards. Its default cookie options would also be wrong
 * for us: `sameSite: "Strict"` does not survive an LTI launch, and with no
 * `path` a cookie set deep in a course URL would not apply at the root. The
 * profile form owns cookie writes instead.
 */
const LANGUAGE_DETECTOR_OPTIONS = {
  caches: false as const,
  fallbackLanguage: DEFAULT_LOCALE,
  ignoreCase: true,
  lookupCookie: LOCALE_COOKIE_NAME,
  // Mutable array on purpose: hono's `DetectorOptions.order` is `DetectorType[]`.
  order: ["cookie", "header"] satisfies DetectorType[] as DetectorType[],
  supportedLanguages: [...SUPPORTED_LOCALES],
};

export function localeDetectorMiddleware(): MiddlewareHandler<AppBindings> {
  const detect = languageDetector(LANGUAGE_DETECTOR_OPTIONS);

  // `applyLocale` runs here as well as in phase two, so that `i18n` is set from
  // the moment a language is known rather than only after authentication.
  // `AppVariables.i18n` is typed as always present; leaving the detector to set
  // `language` alone made that type a lie for every handler in between — the
  // actor lookup, CSRF, and `app.onError`, which is to say precisely the code
  // that runs when a request is being rejected and most needs words for it.
  return (context, next) =>
    detect(context, async () => {
      applyLocale(context, context.get("language"));

      await next();
    });
}

/**
 * Render this request in `requested` — unless the reader is signed in and stored
 * a preference, which outranks anything a single request can carry (its cookie,
 * its `Accept-Language`, an LTI launch's platform locale).
 *
 * The whole precedence rule lives here so that every caller gets it: a route
 * that resolves a locale mid-request (an LTI launch adopting the platform's)
 * must not quietly promote itself above a stored preference.
 *
 * `requested` is whatever the caller has — a detector's answer, an LTI claim —
 * so it is narrowed here rather than trusted. That is what lets `language` be
 * typed `SupportedLocale` downstream instead of `string`, and it costs nothing:
 * `i18nFor` was already folding an unrecognised tag to the default, silently.
 *
 * The one exception is the pseudolocale, which outranks even a stored
 * preference. It is a QA instrument rather than a language: a profile save
 * refuses it (`isSelectableLocale`), so no row can hold it and no reader can be
 * expressing a choice by asking for it, and no browser sends it unbidden. Without the exception `bun run i18n:overflow` is vacuous — it asks
 * for `en-XA` by header, and the staff account it must sign in as to reach the
 * instructor routes has a language stored, so the layout check silently measured
 * that language instead of the padded one it exists to measure.
 */
export function applyLocale(
  context: Context<AppBindings>,
  requested: string,
): void {
  const wanted = isSupportedLocale(requested) ? requested : null;
  const stored = context.get("actor")?.user.locale ?? null;
  const locale =
    wanted === PSEUDO_LOCALE
      ? wanted
      : stored !== null && isSupportedLocale(stored)
        ? stored
        : (wanted ?? DEFAULT_LOCALE);

  context.set("language", locale);
  context.set("i18n", i18nFor(locale));
}

/**
 * Phase two: re-resolve now that the actor is known, so a signed-in user's
 * stored preference can outrank what the request itself asked for.
 *
 * Two phases rather than one because the preference lives on the user row and is
 * only knowable once `actorMiddleware` has resolved the actor — while phase one
 * has to run before that, so a request rejected during authentication (or CSRF)
 * still has a locale to render its error page in. This pass only ever *upgrades*
 * the pair phase one already set; for a signed-out reader, or a reader whose
 * preference matches, it re-derives the same answer.
 */
export function localeMiddleware(): MiddlewareHandler<AppBindings> {
  return async (context, next) => {
    applyLocale(context, context.get("language"));

    await next();
  };
}
