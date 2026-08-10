import type {
  LoginEmailSender,
  SendLoginEmailInput,
} from "../../application/auth";
import { AppHttpError } from "../../application/errors";
import type { Env } from "../../env";

interface ResendEmailResponse {
  readonly id?: unknown;
  readonly message?: unknown;
  readonly name?: unknown;
}

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/**
 * The subject and body of one kind of transactional email. Each part is a
 * function of the recipient's translator, which rides in on the send input:
 * an email is composed once and read once, in whatever language the person
 * asking for it was using.
 */
export interface EmailCopy {
  readonly html: (input: SendLoginEmailInput) => string;
  readonly subject: (input: SendLoginEmailInput) => string;
  readonly text: (input: SendLoginEmailInput) => string;
}

export interface ResendLoginEmailSenderOptions {
  readonly apiKey: string;
  readonly copy?: EmailCopy;
  readonly fetcher?: Fetcher;
  readonly from: string;
}

export class ResendLoginEmailSender implements LoginEmailSender {
  private readonly copy: EmailCopy;
  private readonly fetcher: Fetcher;

  constructor(private readonly options: ResendLoginEmailSenderOptions) {
    this.copy = options.copy ?? loginEmailCopy;
    // Wrapped rather than referenced: calling an unbound global `fetch`
    // through a property throws "Illegal invocation" on Workers.
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  }

  async send(input: SendLoginEmailInput): Promise<void> {
    const response = await this.fetcher("https://api.resend.com/emails", {
      body: JSON.stringify({
        from: this.options.from,
        html: this.copy.html(input),
        subject: this.copy.subject(input),
        text: this.copy.text(input),
        to: [input.email],
      }),
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    if (response.ok) {
      return;
    }

    let detail = "Resend rejected the email.";

    try {
      const body = (await response.json()) as ResendEmailResponse;

      if (typeof body.message === "string" && body.message.length > 0) {
        detail = body.message;
      }
    } catch (_error) {
      // Keep the generic message if Resend does not return JSON.
    }

    throw new AppHttpError(
      500,
      "login_email_delivery_failed",
      `Email delivery failed: ${detail}`,
    );
  }
}

export function loginEmailSenderFromEnv(env: Env): LoginEmailSender | null {
  if (
    env.RESEND_API_KEY === undefined ||
    env.AUTH_LOGIN_EMAIL_FROM === undefined
  ) {
    return null;
  }

  return new ResendLoginEmailSender({
    apiKey: env.RESEND_API_KEY,
    from: env.AUTH_LOGIN_EMAIL_FROM,
  });
}

/**
 * The sender for LTI account-link confirmations: an LMS launch asserted the
 * email of an existing account, and the account owner must approve the link.
 * Same delivery machinery as login links, different copy.
 */
export function ltiLinkEmailSenderFromEnv(env: Env): LoginEmailSender | null {
  if (
    env.RESEND_API_KEY === undefined ||
    env.AUTH_LOGIN_EMAIL_FROM === undefined
  ) {
    return null;
  }

  return new ResendLoginEmailSender({
    apiKey: env.RESEND_API_KEY,
    copy: ltiLinkEmailCopy,
    from: env.AUTH_LOGIN_EMAIL_FROM,
  });
}

const loginEmailCopy: EmailCopy = {
  html: ({ confirmationUrl, expiresInSeconds, i18n, locale }) =>
    [
      `<p>${escapeHtml(i18n.t("Use this link to sign in to Carnap:"))}</p>`,
      `<p><a href="${escapeHtml(confirmationUrl)}">${escapeHtml(i18n.t("Sign in"))}</a></p>`,
      `<p>${escapeHtml(
        i18n.t("This link expires {duration} after it was sent.", {
          duration: formatLifetime(expiresInSeconds, locale),
        }),
      )}</p>`,
    ].join(""),
  subject: ({ i18n }) => i18n.t("Your Carnap login link"),
  text: ({ confirmationUrl, expiresInSeconds, i18n, locale }) =>
    [
      i18n.t("Use this link to sign in to Carnap:"),
      "",
      confirmationUrl,
      "",
      i18n.t("This link expires {duration} after it was sent.", {
        duration: formatLifetime(expiresInSeconds, locale),
      }),
    ].join("\n"),
};

const ltiLinkEmailCopy: EmailCopy = {
  html: ({ confirmationUrl, expiresInSeconds, i18n, locale }) =>
    [
      `<p>${escapeHtml(
        i18n.t(
          "A launch from your institution's LMS asked to connect to your Carnap account. If this was you, use this link to approve it:",
        ),
      )}</p>`,
      `<p><a href="${escapeHtml(confirmationUrl)}">${escapeHtml(i18n.t("Connect LMS identity"))}</a></p>`,
      `<p>${escapeHtml(
        i18n.t("This link expires {duration} after it was sent.", {
          duration: formatLifetime(expiresInSeconds, locale),
        }),
      )} ${escapeHtml(
        i18n.t(
          "If you did not expect this, ignore this email and nothing will be linked.",
        ),
      )}</p>`,
    ].join(""),
  subject: ({ i18n }) => i18n.t("Confirm your Carnap account link"),
  text: ({ confirmationUrl, expiresInSeconds, i18n, locale }) =>
    [
      i18n.t(
        "A launch from your institution's LMS asked to connect to your Carnap account. If this was you, use this link to approve it:",
      ),
      "",
      confirmationUrl,
      "",
      i18n.t("This link expires {duration} after it was sent.", {
        duration: formatLifetime(expiresInSeconds, locale),
      }),
      i18n.t(
        "If you did not expect this, ignore this email and nothing will be linked.",
      ),
    ].join("\n"),
};

/**
 * How long the link lives, as a phrase in the reader's language: "10 minutes",
 * "24 hours", "10 Minuten". `Intl` rather than a hand-built string because it
 * gets the plural and the spacing right in every locale, including the ones
 * where "1 minute" is not simply the number with a word after it.
 *
 * Whole hours are said in hours; everything else in minutes. A day is left as
 * "24 hours" on purpose — for something that expires, hours are the unit the
 * reader is actually counting in.
 */
function formatLifetime(expiresInSeconds: number, locale: string): string {
  const minutes = Math.max(1, Math.round(expiresInSeconds / 60));
  const useHours = minutes >= 60 && minutes % 60 === 0;

  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: useHours ? "hour" : "minute",
    unitDisplay: "long",
  }).format(useHours ? minutes / 60 : minutes);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
