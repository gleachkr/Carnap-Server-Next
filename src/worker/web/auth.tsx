import type { Context } from "hono";
import type { FC } from "hono/jsx";

import type { AppBindings } from "../http";
import { ErrorSummary, Notice, Sheet } from "./components";
import { renderShell, useI18n } from "./layout";

type Status = 200 | 400 | 401 | 403 | 404 | 429 | 500;

const LoginForm: FC<{
  readonly email?: string;
  readonly name?: string;
  readonly next?: string;
}> = ({ email, name, next }) => {
  const i18n = useI18n();

  return (
    <form action="/login" method="post">
      <input name="next" type="hidden" value={next ?? ""} />
      <label>
        {i18n.t("Email")}
        <br />
        <input name="email" required type="email" value={email ?? ""} />
      </label>
      <label>
        {i18n.t("Name, optional")}
        <br />
        <input name="name" value={name ?? ""} />
      </label>
      <button type="submit">{i18n.t("Send login link")}</button>
    </form>
  );
};

export function renderLoginPage(
  context: Context<AppBindings>,
  model: { readonly loggedOut: boolean; readonly next: string },
): Response {
  const i18n = context.get("i18n");

  return renderShell(
    context,
    { showTitle: false, title: i18n.t("Log in") },
    <>
      {model.loggedOut ? (
        <Notice>{i18n.t("You have been logged out.")}</Notice>
      ) : null}
      <Sheet
        description={i18n.t(
          "Use your email address to receive a one-time login link.",
        )}
        title={i18n.t("Account access")}
      >
        <LoginForm next={model.next} />
      </Sheet>
    </>,
  );
}

export function renderLoginError(
  context: Context<AppBindings>,
  model: {
    readonly email: string;
    readonly message: string;
    readonly name: string;
    readonly next: string;
    readonly status: Status;
  },
): Response {
  const i18n = context.get("i18n");

  return renderShell(
    context,
    { showTitle: false, status: model.status, title: i18n.t("Log in") },
    <Sheet title={i18n.t("Account access")}>
      <ErrorSummary>{model.message}</ErrorSummary>
      <LoginForm email={model.email} name={model.name} next={model.next} />
    </Sheet>,
  );
}

export function renderLoginSent(
  context: Context<AppBindings>,
  localLoginLink: string | null,
): Response {
  const i18n = context.get("i18n");

  return renderShell(
    context,
    { showTitle: false, title: i18n.t("Check your email") },
    <Sheet title={i18n.t("Check your email")}>
      <Notice>{i18n.t("A login link has been created.")}</Notice>
      {localLoginLink === null ? null : (
        <p class="token">
          <a href={localLoginLink}>
            {i18n.t("Continue with this local login link")}
          </a>
        </p>
      )}
    </Sheet>,
  );
}
