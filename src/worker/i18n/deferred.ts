import type { TranslatableMessage } from "./translator";

/**
 * Author a message where it belongs, and let something else word it later.
 *
 * The problem this solves is extraction, not translation. A
 * {@link TranslatableMessage} written as a plain object literal —
 * `{ message: "The assignment was not found." }` — is invisible to `lingui
 * extract`, which only reads string literals sitting in the first argument of a
 * `.t(...)` call whose receiver is *named* `i18n` (see `docs/i18n.md`). So a
 * message that no translator is present to resolve has nowhere to live: it
 * cannot call `i18n.t`, and writing the object by hand keeps it out of the
 * catalog, where "out of the catalog" means it renders English forever with
 * nothing failing.
 *
 * Hence the shape. `deferred.i18n` is not a translator and translates nothing:
 * `t` hands back its own arguments as data. It is *named* `i18n` for the single
 * reason that the extractor matches `X.i18n.t(...)` as well as `i18n.t(...)`,
 * which puts the literal in the catalog while leaving the wording to whoever has
 * a locale. The `deferred.` prefix is what keeps it out of the way of the real,
 * request-scoped `i18n` that most route files already hold.
 *
 * Service-layer errors are what it exists for:
 *
 * ```ts
 * throw new AppHttpError(
 *   404,
 *   "assignment_not_found",
 *   deferred.i18n.t("The assignment was not found."),
 * );
 * ```
 *
 * The English is still right there for the JSON envelope and the logs —
 * `AppHttpError` resolves it eagerly — so nothing downstream has to know whether
 * a message will ever be translated.
 *
 * Substitution only, and deliberately: `resolveMessage` fills `{name}`
 * placeholders without ICU, so a deferred message must not need plural or select
 * agreement with one of its values. Decide the wording at the call site instead
 * of asking the sentence to.
 */
export const deferred = {
  i18n: {
    t(
      message: string,
      params?: Readonly<
        Record<string, TranslatableMessage | number | string>
      >,
    ): TranslatableMessage {
      return params === undefined ? { message } : { message, params };
    },
  },
};
