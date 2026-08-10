import { deferred } from "../i18n/deferred";
import {
  resolveMessage,
  type TranslatableMessage,
  type Translator,
  translateMessage,
} from "../i18n/translator";

export type AppErrorStatus = 400 | 401 | 403 | 404 | 429 | 500;

export class AppHttpError extends Error {
  /**
   * The message as a catalog id plus its values, when the thrower wrote one.
   *
   * Present for everything a reader can be shown — which in practice means every
   * error raised in `src/worker/application/`, enforced by
   * `tests/error-messages.test.ts`. Absent for the JSON-shape validators in
   * `src/worker/routes/`: "User ID must be a string." answers a malformed API
   * request, describes this codebase's own contract, and cannot be provoked
   * through a form, so translating it would only ask volunteers to render prose
   * no reader will meet.
   */
  readonly translatable: TranslatableMessage | undefined;

  constructor(
    readonly status: AppErrorStatus,
    readonly code: string,
    /**
     * English prose, or a {@link deferred} message that carries the same English
     * as a catalog id. `Error.message` ends up the same either way — the JSON
     * envelope, the logs, and the tests never see the difference — so a thrower
     * deep in a service can make its words translatable without knowing whether
     * anything will render them.
     */
    message: string | TranslatableMessage,
  ) {
    super(typeof message === "string" ? message : resolveMessage(message));
    this.name = "AppHttpError";
    this.translatable = typeof message === "string" ? undefined : message;
  }

  /**
   * The message worded for a viewer — what an HTML error page should show.
   * Falls back to `message`, which is the English the JSON envelope carries.
   */
  localize(i18n: Translator): string {
    return this.translatable === undefined
      ? this.message
      : translateMessage(this.translatable, i18n);
  }
}

export function badRequest(
  code: string,
  message: string | TranslatableMessage,
): AppHttpError {
  return new AppHttpError(400, code, message);
}

export function unauthorized(code = "unauthenticated"): AppHttpError {
  return new AppHttpError(
    401,
    code,
    deferred.i18n.t("Authentication is required."),
  );
}

export function forbidden(code = "forbidden"): AppHttpError {
  return new AppHttpError(
    403,
    code,
    deferred.i18n.t("You are not allowed to do that."),
  );
}
