import { DEFAULT_LOCALE } from "./locales";

/**
 * The narrow translation surface, defined over nothing but the locale tags.
 *
 * This is a leaf module on purpose. `src/client/editor-preview.ts` imports the
 * Worker's content renderer, markdown compiler, and content-document builder,
 * so those modules and everything they reach are compiled into a *browser*
 * bundle. If any of them imported the real i18n module, `@lingui/core` and
 * every message catalog would ship to the browser. They take a `Translator`
 * parameter instead, and the preview passes one built from a strings payload.
 * (`./locales` is catalog-free too, and `tests/i18n-bundle-guard.test.ts`
 * blesses it by name — only `./index` constructs `I18n` instances.)
 *
 * `@lingui/core`'s `I18n` satisfies this structurally, so nothing wraps it —
 * the wrapper would break message extraction (see below) and buy nothing.
 *
 * IMPORTANT: whatever holds one of these must be *named* `i18n`. `lingui
 * extract` finds messages by matching `i18n.t(...)` / `i18n._(...)` on the
 * receiver's name and never checks imports, which is what lets a passthrough in
 * shared code be extracted like the real thing — and what makes a renamed or
 * destructured binding drop its strings from the catalog with no error at all.
 */
export interface Translator {
  /**
   * The BCP-47 tag whose catalog {@link t} answers from.
   *
   * It rides on the translator rather than travelling beside it, because a
   * locale that arrives as a second argument is a locale that can disagree with
   * the prose: the two used to be read from separate context keys at every call
   * site, and every one of them had to remember to keep them in step. Anything
   * that needs the tag as well as the words — `<html lang>`, `Intl` formatting
   * in a client script — now takes both off one object.
   *
   * `@lingui/core`'s `I18n` already exposes this, so nothing wraps it.
   */
  readonly locale: string;

  /**
   * Translate `id` — the English source text — substituting `values` into its
   * ICU placeholders. An id with no catalog entry returns the id, so a missing
   * translation reads as English rather than as a key.
   *
   * `options.comment` is a note to the translator, carried into the PO file as
   * an extracted comment. `options.message` supplies the text to *display* when
   * it differs from the id, which is how two same-worded strings needing
   * different translations are told apart: the id is made unique
   * (`"Open (assignment availability)"`) and the message stays the plain word.
   * Lingui's `msgctxt` cannot do that job here — with explicit ids the catalog
   * is keyed by id alone, so a context would silently collapse the two.
   */
  t(
    id: string,
    values?: Record<string, unknown>,
    options?: { readonly comment?: string; readonly message?: string },
  ): string;
}

/**
 * The value handed to a placeholder that an *element* will fill — a date, a
 * link, a badge — rather than text. Pair it with {@link splitAtValue}.
 *
 * A NUL, because no message and no translation of one can contain a NUL, so the
 * split can never land in the middle of real prose.
 */
export const VALUE = "\u0000";

/**
 * Split a message at the one placeholder an element occupies, giving the text
 * before it and the text after it.
 *
 * Some sentences wrap an element: "Opens <time>", "Closes <time>". Rendering the
 * words and the element as separate siblings bakes English word order in — a
 * translator who needs the date first cannot say so, and the fragments reach the
 * catalog as loose words instead of a sentence. Passing {@link VALUE} for that
 * placeholder keeps the whole sentence translatable as one unit, and this splits
 * the result so the element lands where the translator put the placeholder.
 *
 * The literal has to stay at the `i18n.t(...)` call for extraction to see it, so
 * the shape at the call site is always:
 *
 * ```tsx
 * const [before, after] = splitAtValue(i18n.t("Opens {when}", { when: VALUE }));
 *
 * return <>{before}<Time value={assignment.availableFrom} />{after}</>;
 * ```
 */
export function splitAtValue(message: string): readonly [string, string] {
  const at = message.indexOf(VALUE);

  if (at < 0) {
    return [message, ""];
  }

  return [message.slice(0, at), message.slice(at + VALUE.length)];
}

/**
 * A translator that returns each message's id — the English source text — with
 * `{name}` placeholders filled in.
 *
 * A fixture, not a production path. It was the browser authoring preview's
 * translator until that preview started wording itself from the strings payload
 * the server resolves for it (`payloadTranslator`), which is what keeps a
 * rebuild in the reader's language. Nothing in the Worker uses it.
 *
 * What it is still for is the tests, and there it earns its keep: a unit test of
 * render code wants the English source back verbatim, and asserting on that is
 * only sound if a *missing* catalog entry and a *present* English one are
 * indistinguishable — which is exactly this. It stays in the leaf module because
 * some of those tests exercise code shared with the browser bundle.
 */
export const passthroughTranslator: Translator = {
  locale: DEFAULT_LOCALE,
  t: (id, values, options) =>
    // Same precedence the real catalog lookup uses for a missing entry: the
    // explicit display message if there is one, otherwise the id itself.
    formatMessage(options?.message ?? id, values),
};

/**
 * Values that carry a message's own placeholders through `i18n.t` unchanged, for
 * a message the *browser* will fill in later.
 *
 * `i18n.t(id)` does not hand back the translated template — it *formats* it, and
 * ICU formatting substitutes an argument the caller did not supply with the empty
 * string. So resolving `"Submitted at {when}."` with no values yields
 * `"Submitted at ."`, and the placeholder the client meant to fill is already
 * gone. Passing each placeholder its own name as its value makes the format step
 * a no-op:
 *
 * ```ts
 * i18n.t("Correct cells: {count} of {total}", placeholders("count", "total"))
 * ```
 *
 * The invariant this protects is checked, not just documented: every string a
 * widget or an enhancement script receives must come back from the English
 * catalog byte-identical to its id (see `tests/exercise-strings.test.ts` and
 * `tests/ui-strings.test.ts`), which fails loudly if a placeholder is eaten.
 */
export function placeholders(
  ...names: readonly string[]
): Record<string, string> {
  return Object.fromEntries(names.map((name) => [name, `{${name}}`]));
}

/**
 * A message produced somewhere that has no translator, carried as data until
 * something with a catalog can word it.
 *
 * Compiler diagnostics are the case this exists for. They are generated deep in
 * DOM-free authoring code that also runs in the browser preview bundle, so they
 * cannot call `i18n.t` — and their text is not fixed at the call site anyway
 * (which attribute, which formula, which line). So the producer emits the
 * English source text *unfilled*, plus the values that fill it, and the display
 * side resolves both at once against the viewer's catalog.
 *
 * `message` doubles as the catalog id, exactly as everywhere else in this
 * codebase, so a missing entry degrades to readable English.
 */
export interface TranslatableMessage {
  /** English source text, and the catalog id; `{slots}` come from `params`. */
  readonly message: string;
  /**
   * The values `message` interpolates. A value may itself be a
   * {@link TranslatableMessage} — a sub-parser's own complaint quoted inside a
   * wrapper sentence — which is resolved first, so the inner text is translated
   * too instead of arriving as an English island.
   */
  readonly params?: Readonly<
    Record<string, TranslatableMessage | number | string>
  >;
}

/**
 * How one message id becomes words. The two implementations that matter are a
 * real catalog lookup (`i18n.t`, on the server) and a map the server resolved
 * ahead of time (in a browser bundle, which has neither).
 */
export type MessageResolver = (
  id: string,
  values?: Readonly<Record<string, string>>,
) => string;

/**
 * Word a {@link TranslatableMessage}: resolve any nested message first, then the
 * sentence that quotes it.
 *
 * `resolve` defaults to plain substitution into the id, which yields the English
 * sentence — what the JSON API, the logs, and the tests want, and why a producer
 * never has to know whether anyone will translate what it emits.
 */
export function resolveMessage(
  message: TranslatableMessage,
  resolve: MessageResolver = formatMessage,
): string {
  if (message.params === undefined) {
    return resolve(message.message);
  }

  const values: Record<string, string> = {};

  for (const [name, value] of Object.entries(message.params)) {
    values[name] =
      typeof value === "object"
        ? resolveMessage(value, resolve)
        : String(value);
  }

  return resolve(message.message, values);
}

/** {@link resolveMessage} against a real catalog. */
export function translateMessage(
  message: TranslatableMessage,
  i18n: Translator,
): string {
  return resolveMessage(message, (id, values) => i18n.t(id, values));
}

/**
 * {@link resolveMessage} against strings the server already resolved, keyed by
 * English source text — the shape a browser bundle receives them in.
 */
export function stringsResolver(
  strings: Readonly<Record<string, string>>,
): MessageResolver {
  return (id, values) => formatMessage(strings[id] ?? id, values);
}

/**
 * Fill `{name}` placeholders in a message that is *already* in the right
 * language, leaving any placeholder `values` has no entry for untouched.
 *
 * Substitution, not ICU: no plural or select selection, no number or date
 * formatting. That is all a browser can do with a message the server resolved
 * for it — which is why the interactive widgets and the enhancement scripts
 * share this and why their copy must not need agreement with a value (see
 * `ExerciseHydration.strings`). On the server, `i18n.t` does the real thing.
 */
export function formatMessage(
  message: string,
  values?: Readonly<Record<string, unknown>>,
): string {
  if (values === undefined) {
    return message;
  }

  return message.replaceAll(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}
