import type { Child } from "hono/jsx";
import { createContext, type FC, useContext } from "hono/jsx";

import type { Translator } from "../i18n/translator";

/**
 * The viewer's translator, made ambient for the whole render so a deep leaf can
 * produce text without every component between here and there carrying a prop
 * for it.
 *
 * This is safe under concurrency, but only because the render is synchronous.
 * Without `nodejs_compat` there is no `AsyncLocalStorage`, so `hono/jsx` keeps
 * provided values in a module-scoped store that it sets for the duration of
 * `toString()` and clears in a `finally`. A synchronous render has no await
 * point, so no other request's render can interleave into that window on this
 * single-threaded isolate. The `typeof rendered !== "string"` guards in
 * `renderShell` and in `contentDocumentHtml` are what hold that precondition in
 * place — an async view component would break this, and those guards turn that
 * into a loud error instead of a wrong page.
 *
 * Its own module, rather than living in the layout, because the standalone
 * content document needs the same provider and is compiled into the browser
 * preview bundle: importing the layout there would drag the app shell (and its
 * styles) into that bundle.
 */
const I18nContext = createContext<Translator | null>(null);

export const I18nProvider: FC<{
  readonly children: Child;
  readonly i18n: Translator;
}> = ({ children, i18n }) => (
  <I18nContext.Provider value={i18n}>{children}</I18nContext.Provider>
);

/**
 * The viewer's translator. Throws rather than falling back to English when no
 * provider is in scope: a silent fallback would render fine in English and
 * quietly ship untranslatable text, which is exactly what the pseudolocale
 * check exists to catch.
 */
export function useI18n(): Translator {
  const i18n = useContext(I18nContext);

  if (i18n === null) {
    throw new Error("useI18n() was called outside an I18nContext provider.");
  }

  return i18n;
}
