import { describe, expect, test } from "bun:test";
import { messages as enMessages } from "../src/locales/en/messages";
import {
  CATALOGS,
  DEFAULT_LOCALE,
  i18nFor,
  isSupportedLocale,
  LOCALE_NAMES,
  PSEUDO_LOCALE,
  passthroughTranslator,
  SELECTABLE_LOCALES,
  SUPPORTED_LOCALES,
} from "../src/worker/i18n";

/** The ICU argument names an id declares, read the way its author wrote it. */
function placeholdersIn(id: string): Set<string> {
  // `{name}`, `{name, plural, …}`, `{name, number, percent}`: the name always
  // runs to a comma or a closing brace. `#` inside a plural is not a name, and
  // needs no separate check — it can only stand for the argument that owns it.
  return new Set(
    [...id.matchAll(/\{\s*([A-Za-z0-9_]+)\s*[,}]/g)].map(
      (match) => match[1] ?? "",
    ),
  );
}

/** The ICU argument names a *compiled* catalog entry will actually fill in. */
function argumentsIn(
  message: unknown,
  found = new Set<string>(),
): Set<string> {
  // Compiled entries are Lingui's AST, not strings: a token list whose members
  // are literal strings or `[name, format?, choices?]` argument nodes, where
  // `choices` (plural/select) maps each case to a nested token list. Looking
  // for a `{name}` substring instead would find text that merely *looks* like
  // a placeholder — which is exactly the failure below.
  if (!Array.isArray(message)) {
    return found;
  }

  for (const token of message) {
    if (!Array.isArray(token)) {
      continue;
    }

    const [name, , choices] = token as unknown[];

    if (typeof name === "string") {
      found.add(name);
    }

    if (typeof choices === "object" && choices !== null) {
      for (const branch of Object.values(choices)) {
        argumentsIn(branch, found);
      }
    }
  }

  return found;
}

/**
 * Guards on the catalog plumbing itself, as distinct from whether any given
 * string has been extracted. Most of these exist because the corresponding
 * mistake is *silent*: the app keeps rendering readable English while every
 * other language quietly stops working.
 */
describe("i18n catalogs", () => {
  test("a locale's catalog is actually loaded and active", () => {
    // The failure this catches: `setupI18n`'s `messages` is keyed by locale, so
    // handing it a bare catalog is accepted and yields an empty active one, in
    // which every message resolves to its own id. English would look perfect.
    const i18n = i18nFor("de");

    expect(i18n.locale).toBe("de");
    expect(i18n.t("Courses")).toBe("Kurse");
    expect(i18n.t("Courses")).not.toBe("Courses");
  });

  test("every supported locale resolves and translates or falls back", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const i18n = i18nFor(locale);

      expect(i18n.locale).toBe(locale);
      // Not the id, and not empty: either a translation or the source fallback.
      expect(i18n.t("Courses").length).toBeGreaterThan(0);
    }
  });

  test("an unknown locale falls back to the default rather than throwing", () => {
    expect(i18nFor("qq-ZZ").locale).toBe(DEFAULT_LOCALE);
    expect(i18nFor("").locale).toBe(DEFAULT_LOCALE);
  });

  test("instances are memoized, so no request mutates a shared catalog", () => {
    expect(i18nFor("de")).toBe(i18nFor("de"));
    expect(i18nFor("de")).not.toBe(i18nFor("en"));
  });

  test("a message with no catalog entry renders as its English source", () => {
    // The whole reason ids are the source text: an unextracted or
    // newly-added string degrades to readable English, never to a bare key.
    expect(i18nFor("de").t("Not a real message in any catalog.")).toBe(
      "Not a real message in any catalog.",
    );
  });

  test("the pseudolocale differs from English wherever it is translated", () => {
    // Its job is to make untranslated text visible, so it must not be a
    // no-op — and it must keep ICU/placeholder structure intact, which is why
    // the check is "differs" rather than an exact expected string.
    const pseudo = i18nFor("en-XA").t("Courses");

    expect(pseudo).not.toBe("Courses");
    expect(pseudo).toContain("ō");
  });

  test("the English catalog has no duplicate ids", () => {
    // `msgctxt` cannot disambiguate under explicit ids: Lingui keys the catalog
    // by id and looks up that flat key, so two same-English strings needing
    // different translations would silently collapse into one entry. Unique
    // ids are the only defence, so the PO must never carry a msgctxt.
    const po = Bun.file("src/locales/en/messages.po");

    return po.text().then((text) => {
      const ids = [...text.matchAll(/^msgid "(.+)"$/gm)].map(
        (match) => match[1],
      );

      expect(ids.length).toBeGreaterThan(0);
      expect(new Set(ids).size).toBe(ids.length);
      expect(text).not.toContain("msgctxt");
    });
  });

  test("every locale's compiled catalog carries the English keys", () => {
    // A translator may leave entries empty — that is fine and falls back — but a
    // locale missing a *key* means its compiled catalog is stale relative to
    // the source, which `bun run i18n` fixes.
    //
    // This compares the catalog objects, not rendered output. Asking
    // `i18n.t(key)` cannot see the difference: ids are the English source, so a
    // missing key renders as itself and every key "translates" — a wholly empty
    // catalog passes such a check for all 660 of them.
    const englishKeys = Object.keys(enMessages).sort();

    expect(englishKeys.length).toBeGreaterThan(0);

    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(CATALOGS[locale]).sort()).toEqual(englishKeys);
    }
  });

  test("no translation drops a placeholder its id declares", () => {
    // A translation that loses a `{count}` renders it as nothing — no error, no
    // fallback, and only in that one language. The usual cause is ICU's
    // apostrophe rule: `'` opens an escape *only* before `{`, `}` or `#`, so a
    // translator who quotes a placeholder as '{token}' turns it into literal
    // text, and the value silently never appears.
    //
    // Nothing is excluded. Obsolete (`#~`) entries used to be, because two of
    // them were frozen instances of this very bug; `lingui extract --clean`
    // now drops them at extraction, so the sweep covers the whole catalog.
    let checked = 0;

    for (const locale of SUPPORTED_LOCALES) {
      for (const [id, message] of Object.entries(CATALOGS[locale])) {
        const declared = placeholdersIn(id);

        if (declared.size === 0) {
          continue;
        }

        const kept = argumentsIn(message);
        const missing = [...declared].filter((name) => !kept.has(name));

        // Reported as an object so a failure names the locale and the string.
        expect({ id, locale, missing }).toEqual({
          id,
          locale,
          missing: [],
        });
        checked += 1;
      }
    }

    expect(checked).toBeGreaterThan(0);
  });

  test("every selectable locale is one a reader can be given", () => {
    // Membership in `SUPPORTED_LOCALES` is now a type-level fact, so what is
    // left to assert is that offering a language means having something to
    // offer: a catalog with entries, and an endonym to label the switcher with.
    expect(SELECTABLE_LOCALES.length).toBeGreaterThan(0);

    for (const locale of SELECTABLE_LOCALES) {
      expect(Object.keys(CATALOGS[locale]).length).toBeGreaterThan(0);
      expect(LOCALE_NAMES[locale].length).toBeGreaterThan(0);
    }

    expect(SELECTABLE_LOCALES).toContain(DEFAULT_LOCALE);
    // Servable on request, but never presented as a language to choose.
    expect(isSupportedLocale(PSEUDO_LOCALE)).toBe(true);
    expect(SELECTABLE_LOCALES).not.toContain(PSEUDO_LOCALE);
  });

  test("the passthrough translator returns ids with placeholders filled", () => {
    // The browser authoring preview's translator: no catalog, no locale, so the
    // English source is the output — which is the current behaviour there.
    expect(passthroughTranslator.t("Courses")).toBe("Courses");
    expect(
      passthroughTranslator.t("{count} of {total} cells", {
        count: 2,
        total: 4,
      }),
    ).toBe("2 of 4 cells");
    // An unknown placeholder is left alone rather than blanked.
    expect(passthroughTranslator.t("Hello {who}", {})).toBe("Hello {who}");
  });
});
