import { type I18n, setupI18n } from "@lingui/core";

import { messages as deMessages } from "../../locales/de/messages";
import { messages as enMessages } from "../../locales/en/messages";
import { messages as pseudoMessages } from "../../locales/en-XA/messages";
import type { SupportedLocale } from "./locales";
import { DEFAULT_LOCALE, isSupportedLocale } from "./locales";

/**
 * Exported for `i18n-catalogs.test.ts`, which has to inspect the compiled
 * objects themselves. Rendering cannot answer its questions: ids *are* the
 * English source, so a missing entry resolves to its own id and every
 * assertion about the rendered string passes against an empty catalog.
 */
export const CATALOGS: Record<SupportedLocale, typeof enMessages> = {
  de: deMessages,
  en: enMessages,
  "en-XA": pseudoMessages,
};

/**
 * One immutable `I18n` per locale, built on first use and kept for the
 * isolate's life.
 *
 * The shape matters. Lingui's module-global `i18n` singleton with
 * `activate(locale)` would be a cross-request bug here: one isolate serves many
 * concurrent requests, so a second request's `activate` would retarget the
 * first's half-finished render. `setupI18n` activates inside its constructor,
 * so nothing calls `activate` at request time and these instances are never
 * mutated after construction. For the same reason, never attach a `missing`
 * handler to one of these — that is request state on a shared object.
 *
 * Note `messages` is keyed *by locale*: `{ de: catalog }`, not the catalog
 * itself. Passing a bare catalog is accepted and yields an empty active
 * catalog, in which every message renders as its own id — which looks perfect
 * in English and silently breaks every other language. Hence one construction
 * site, and `i18n-catalogs.test.ts` asserting a real translation comes back.
 */
const instances = new Map<SupportedLocale, I18n>();

export function i18nFor(locale: string): I18n {
  const key = isSupportedLocale(locale) ? locale : DEFAULT_LOCALE;
  const existing = instances.get(key);

  if (existing !== undefined) {
    return existing;
  }

  const created = setupI18n({
    locale: key,
    messages: { [key]: CATALOGS[key] },
  });

  instances.set(key, created);

  return created;
}

// Both re-exports below are for the convenience of callers that already have a
// catalog in scope, and both come from leaf modules on purpose: importing them
// reaches no catalog. Anything on the browser side of the fence must import
// `./translator` or `./locales` directly — this barrel is the one module
// `tests/i18n-bundle-guard.test.ts` forbids it to reach.
export {
  DEFAULT_LOCALE,
  isSelectableLocale,
  isSupportedLocale,
  LOCALE_NAMES,
  matchSupportedLocale,
  PSEUDO_LOCALE,
  SELECTABLE_LOCALES,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from "./locales";
export { passthroughTranslator } from "./translator";
