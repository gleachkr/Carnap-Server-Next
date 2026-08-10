/**
 * Which locales exist, and how an arbitrary language tag maps onto one.
 *
 * Separate from `./index` because that module imports every message catalog:
 * validating a stored preference or an LTI claim is a question about the *set*
 * of locales, not about their contents, and the services that ask it should not
 * have to pull three catalogs in to do so.
 */

/**
 * The locales the app can serve. `en-XA` is the generated pseudolocale — every
 * message accented and lengthened — which exists so untranslated text and
 * layout overflow are visible in tests and manual QA. It stays out of the
 * languages a reader can choose, but reaching it with `Accept-Language: en-XA`
 * is harmless and useful.
 */
export const SUPPORTED_LOCALES = ["en", "de", "en-XA"] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = "en";

/**
 * The generated pseudolocale — a QA tool, never a language on offer.
 *
 * Because it is an instrument rather than a language, `applyLocale` lets
 * `Accept-Language: en-XA` outrank even a signed-in reader's stored preference.
 * That exception is safe only as long as this stays out of `SELECTABLE_LOCALES`,
 * which is what stops a profile save from ever storing it: nobody asking for it
 * can be expressing a choice.
 */
export const PSEUDO_LOCALE = "en-XA" satisfies SupportedLocale;

/**
 * The locales the profile form offers, i.e. everything a reader would choose.
 *
 * Derived rather than listed: a hand-maintained parallel list is the one place
 * adding a language fails *silently*. `LOCALE_NAMES` and `CATALOGS` are keyed
 * by `SupportedLocale`, so tsc demands entries there, but nothing would have
 * demanded an entry here — the new language would resolve, translate, and
 * serve via `Accept-Language`, yet never appear on the form.
 */
export const SELECTABLE_LOCALES: readonly SupportedLocale[] =
  SUPPORTED_LOCALES.filter((locale) => locale !== PSEUDO_LOCALE);

/** Endonyms: a language is named in itself, so a reader can find their own. */
export const LOCALE_NAMES: Record<SupportedLocale, string> = {
  de: "Deutsch",
  en: "English",
  "en-XA": "Pseudolocale",
};

export function isSupportedLocale(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * The closest locale we serve to the one `tag` names, or null for none.
 *
 * An exact match first, then the primary subtag — an LMS reports a full tag
 * (`de-AT`, `en-GB`), and serving German to an Austrian beats serving English.
 * Tags are case-insensitive by BCP 47, and platforms are inconsistent about it.
 */
export function matchSupportedLocale(tag: string): SupportedLocale | null {
  const wanted = tag.trim().toLowerCase();

  if (wanted.length === 0) {
    return null;
  }

  const exact = SUPPORTED_LOCALES.find(
    (locale) => locale.toLowerCase() === wanted,
  );

  if (exact !== undefined) {
    return exact;
  }

  const primary = wanted.split("-")[0] ?? "";

  return (
    SUPPORTED_LOCALES.find((locale) => locale.toLowerCase() === primary) ??
    null
  );
}

/** Whether `value` is a locale a reader is allowed to pin to their account. */
export function isSelectableLocale(value: string): value is SupportedLocale {
  return (SELECTABLE_LOCALES as readonly string[]).includes(value);
}
