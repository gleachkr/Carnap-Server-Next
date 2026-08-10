import type { Context } from "hono";

import type { AuthenticatedActor } from "../application/auth";
import type { ExternalIdentityProvider } from "../domain/users";
import type { AppBindings } from "../http";
import { LOCALE_NAMES, SELECTABLE_LOCALES } from "../i18n/locales";
import type { SummaryItem } from "./components";
import {
  CsrfInput,
  ErrorSummary,
  Notice,
  Sheet,
  SummaryStrip,
  TableScroll,
  Time,
} from "./components";
import { capabilityLabel, identityProviderLabel } from "./labels";
import { renderShell, useI18n } from "./layout";

/** An external identity resolved for display: LTI ones carry the platform name. */
export interface ProfileIdentity {
  readonly id: string;
  readonly provider: ExternalIdentityProvider;
  readonly createdAt: string;
  /** The LMS platform's registered name; null for native identities. */
  readonly platformName: string | null;
}

/** Distinct labels, in first-seen order, joined for a summary value. */
function joinDistinct(labels: readonly string[]): string {
  return [...new Set(labels)].join(", ");
}

interface ProfileViewOptions {
  /** A validation message to surface when a save was rejected. */
  readonly error?: string;
  /**
   * The language to preselect, `""` for "follow my browser". As with
   * {@link nameValue}: the rejected input on error, the stored preference
   * otherwise.
   */
  readonly localeValue?: string;
  /** The name to prefill (the rejected input on error; otherwise the stored name). */
  readonly nameValue?: string;
  /** A confirmation banner, e.g. after a successful save. */
  readonly notice?: string;
}

/**
 * The signed-in user's own account page: one form for everything a user controls
 * about themselves, the read-only facts about their account, and the single place
 * the log-out control lives. Future preferences (a theme, notification settings)
 * belong in that same form rather than beside it — one set of inputs and one Save
 * is what makes the page readable as "your settings" instead of a stack of
 * unrelated widgets.
 */
export function renderProfile(
  context: Context<AppBindings>,
  actor: AuthenticatedActor,
  identities: readonly ProfileIdentity[],
  options: ProfileViewOptions = {},
): Response {
  const i18n = context.get("i18n");
  const { user } = actor;
  const nameValue = options.nameValue ?? user.name ?? "";
  const localeValue = options.localeValue ?? user.locale ?? "";

  const facts: SummaryItem[] = [];

  if (actor.capabilities.length > 0) {
    facts.push({
      label: i18n.t("Platform roles"),
      value: joinDistinct(
        actor.capabilities.map((grant) =>
          capabilityLabel(i18n, grant.capability),
        ),
      ),
    });
  }

  facts.push({
    label: i18n.t("Sign-in"),
    value: joinDistinct(
      identities.map((identity) =>
        identityProviderLabel(i18n, identity.provider),
      ),
    ),
  });

  facts.push({
    label: i18n.t("Member since"),
    value: <Time value={user.createdAt} />,
  });

  return renderShell(
    context,
    { title: i18n.t("Profile") },
    <Sheet
      className="profile-sheet"
      description={i18n.t("Your account details and preferences.")}
      footer={
        <form action="/logout" class="logout-form" method="post">
          <CsrfInput context={context} />
          <button type="submit">{i18n.t("Log out")}</button>
        </form>
      }
      title={i18n.t("Account")}
    >
      {options.notice === undefined ? null : (
        <Notice>{options.notice}</Notice>
      )}
      {options.error === undefined ? null : (
        <ErrorSummary>{options.error}</ErrorSummary>
      )}
      <form action="/profile" method="post">
        <CsrfInput context={context} />
        <div class="field-grid wide-fields">
          <label>
            {i18n.t("Name")}
            <br />
            <input maxlength={200} name="name" value={nameValue} />
          </label>
          <label>
            {i18n.t("Language")}
            <br />
            <select name="locale">
              {/* The default, and the way back to it: with nothing recorded,
                  Carnap follows the request — this browser's cookie, its
                  `Accept-Language`, an LTI launch's platform locale. Saving a
                  language pins it to the account instead, which is what makes it
                  survive a new browser and reach an emailed login link. */}
              <option selected={localeValue === ""} value="">
                {i18n.t("Match my browser")}
              </option>
              {SELECTABLE_LOCALES.map((locale) => (
                <option selected={locale === localeValue} value={locale}>
                  {/* An endonym, so a reader can find their own language even
                      when the page is written in one they cannot read. */}
                  {LOCALE_NAMES[locale]}
                </option>
              ))}
            </select>
          </label>
          <label>
            {i18n.t("Email")}
            <br />
            <input readonly value={user.email} />
            {user.emailVerifiedAt === null ? (
              <span class="small">
                {i18n.t(
                  "Unverified — this address came from an LMS launch; signing in by email once will verify it.",
                )}
              </span>
            ) : null}
          </label>
        </div>
        <button type="submit">{i18n.t("Save changes")}</button>
      </form>
      <SummaryStrip items={facts} />
      <LtiIdentities context={context} identities={identities} />
    </Sheet>,
  );
}

/**
 * The LMS identities attached to this account, each removable: if a launch
 * linked an LMS user the account owner does not recognize, this is where
 * they undo it. A relaunch from that LMS goes back through link approval.
 */
function LtiIdentities({
  context,
  identities,
}: {
  readonly context: Context<AppBindings>;
  readonly identities: readonly ProfileIdentity[];
}) {
  const i18n = useI18n();
  const ltiIdentities = identities.filter(
    (identity) => identity.provider === "lti",
  );

  if (ltiIdentities.length === 0) {
    return null;
  }

  return (
    <>
      <h3>{i18n.t("Linked LMS access")}</h3>
      <TableScroll>
        <thead>
          <tr>
            <th>{i18n.t("LMS")}</th>
            <th>{i18n.t("Linked")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {ltiIdentities.map((identity) => (
            <tr>
              <td>{identity.platformName ?? i18n.t("LMS (LTI)")}</td>
              <td>
                <Time value={identity.createdAt} />
              </td>
              <td>
                <form action="/profile/identities/remove" method="post">
                  <CsrfInput context={context} />
                  <input
                    name="identityId"
                    type="hidden"
                    value={identity.id}
                  />
                  <button class="danger" type="submit">
                    {i18n.t("Remove")}
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </TableScroll>
    </>
  );
}
