import type { Context } from "hono";
import type { FC } from "hono/jsx";

import type { AppBindings } from "../http";
import { allowTurnstileWidget } from "../middleware/security-headers";
import { ErrorSummary, Notice, Sheet } from "./components";
import { renderShell, useI18n } from "./layout";

type Status = 200 | 400 | 401 | 403 | 404 | 429 | 500;

interface TurnstileWidget {
  /** Turnstile localizes its own copy; this is the page's resolved tag. */
  readonly language: string;
  readonly siteKey: string;
}

/**
 * The widget appears only when *both* keys are set, while the server enforces
 * on the secret alone (`turnstileFromEnv`). The asymmetry is which way each
 * misconfiguration fails: a secret without a site key refuses every login
 * loudly on the first test sign-in, where a widget rendered without a secret
 * to check its tokens would be theater — the reassuring checkbox with the
 * gate it implies quietly off.
 *
 * Calling this is also what widens the page's CSP to Cloudflare's challenge
 * origin, so the grant cannot outlive the widget it exists for.
 */
function turnstileWidget(
  context: Context<AppBindings>,
): TurnstileWidget | null {
  const { TURNSTILE_SECRET_KEY, TURNSTILE_SITE_KEY } = context.env;

  if (
    TURNSTILE_SECRET_KEY === undefined ||
    TURNSTILE_SITE_KEY === undefined
  ) {
    return null;
  }

  allowTurnstileWidget(context);

  return {
    language: context.get("language"),
    siteKey: TURNSTILE_SITE_KEY,
  };
}

/**
 * Signing in and signing up are one form, because they are one operation: the
 * address either has an account or is about to. Nothing else is asked for here
 * — a name used to be, and it was the wrong place for it twice over. An
 * unauthenticated request got to choose the name a new account was created
 * under, and a returning user met a field that was quietly discarded, since the
 * name only ever applied at creation. What is missing from an account is asked
 * for once the person is signed in and can answer for themselves (see
 * `ProfilePrompt`).
 */
const LoginForm: FC<{
  readonly email?: string;
  readonly next?: string;
  readonly turnstile: TurnstileWidget | null;
}> = ({ email, next, turnstile }) => {
  const i18n = useI18n();

  return (
    <form action="/login" method="post">
      <input name="next" type="hidden" value={next ?? ""} />
      <label>
        {i18n.t("Email")}
        <br />
        <input name="email" required type="email" value={email ?? ""} />
      </label>
      {turnstile === null ? null : (
        <>
          {/* Turnstile's script finds this container, renders the challenge
              in it, and writes the passed token into a hidden
              `cf-turnstile-response` input of this form — no code of ours
              runs. Usually invisible: managed mode only escalates to a
              visible check when the client looks suspicious. */}
          <div
            class="cf-turnstile"
            data-language={turnstile.language}
            data-sitekey={turnstile.siteKey}
          ></div>
          <script
            async
            defer
            src="https://challenges.cloudflare.com/turnstile/v0/api.js"
          ></script>
        </>
      )}
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
    { title: i18n.t("Log in") },
    <>
      {model.loggedOut ? (
        <Notice>{i18n.t("You have been logged out.")}</Notice>
      ) : null}
      {/* One sentence for both cases, deliberately: the page must read the
          same to someone who has an account and someone who does not, or the
          copy would say what the response is careful not to. */}
      <Sheet
        description={i18n.t(
          "Enter your email address and we will send you a one-time login link. If you do not have an account yet, following the link creates one.",
        )}
        title={i18n.t("Account access")}
      >
        <LoginForm next={model.next} turnstile={turnstileWidget(context)} />
      </Sheet>
    </>,
  );
}

export function renderLoginError(
  context: Context<AppBindings>,
  model: {
    readonly email: string;
    readonly message: string;
    readonly next: string;
    readonly status: Status;
  },
): Response {
  const i18n = context.get("i18n");

  return renderShell(
    context,
    { status: model.status, title: i18n.t("Log in") },
    <Sheet title={i18n.t("Account access")}>
      <ErrorSummary>{model.message}</ErrorSummary>
      <LoginForm
        email={model.email}
        next={model.next}
        turnstile={turnstileWidget(context)}
      />
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
    { title: i18n.t("Check your email") },
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
