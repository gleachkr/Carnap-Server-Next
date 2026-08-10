import { defineConfig } from "@lingui/conf";
import { formatter } from "@lingui/format-po";

/**
 * Message catalogs for the Worker's own text. Two conventions carry most of the
 * weight here, and both are load-bearing:
 *
 * 1. **A message's id is its English source text**, gettext-style. So an
 *    untranslated string renders as clean English rather than a dotted key, and
 *    a translator opening the PO sees the sentence they are translating as the
 *    `msgid`.
 * 2. **The extractor matches calls by receiver name**, not by import — only
 *    `i18n.t(...)` / `i18n._(...)` are found (any member expression ending in
 *    `.i18n` counts, so `context.i18n.t(...)` works too). A destructured
 *    `const { t } = …; t("…")` extracts *nothing, silently*. Whatever holds the
 *    translator — variable, prop, parameter, field — must be named `i18n`.
 *
 * Note that `msgctxt` cannot disambiguate two identical English strings here:
 * the catalog is keyed by id and the runtime looks up that flat key, so both
 * calls would collapse into one entry. Where the same English needs different
 * translations, make the *id* unique and supply the clean prose separately:
 *
 *   i18n.t("Save (toolbar button)", {}, { message: "Save", comment: "Verb." })
 */

/**
 * Where the catalogs are written — normally the committed tree.
 * `scripts/i18n-check.ts` points this at a temp directory so the staleness and
 * coverage checks can re-extract and re-compile without touching
 * `src/locales/`, which is what lets them run on a dirty tree. Only the
 * *output* moves: `rootDir` is still the repo, so the extraction scope and the
 * `#:` origin comments come out identical either way.
 */
const catalogDir =
  process.env.CARNAP_I18N_CATALOG_DIR ?? "<rootDir>/src/locales";

export default defineConfig({
  catalogs: [
    {
      include: ["<rootDir>/src"],
      path: `${catalogDir}/{locale}/messages`,
    },
  ],
  // `.ts`, not `.mjs`: the repo sets `allowJs: false`, so an undeclared `.mjs`
  // import would fail `bun run check`.
  compileNamespace: "ts",
  format: formatter({
    // Our ids *are* the source text, so the per-entry `js-lingui-explicit-id`
    // marker says nothing; dropping it keeps the PO gettext-idiomatic.
    explicitIdAsDefault: true,
    // A committed catalog should not churn every time a component moves down a
    // few lines. File paths stay; line numbers go.
    lineNumbers: false,
    printPlaceholdersInComments: false,
  }),
  locales: ["en", "de", "en-XA"],
  // Sort on the id. The default `orderBy: "message"` sorts on a field that is
  // `undefined` for every explicit-id entry, so every comparison ties and file
  // order becomes extraction order — which churns on renames and defeats the
  // staleness diff in `bun run i18n:check`.
  orderBy: "messageId",
  // Generated at compile time from the English source and never hand-edited:
  // a pseudolocale exists to make untranslated text and layout overflow
  // visible, so `src/locales/en-XA/messages.po` stays all-empty on purpose.
  pseudoLocale: { extend: 0.35, locale: "en-XA" },
  sourceLocale: "en",
});
