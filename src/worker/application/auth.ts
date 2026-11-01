import type { PlatformCapabilityGrant } from "../domain/admin";
import type { AuthSession } from "../domain/auth";
import { createAppId } from "../domain/ids";
import { addSeconds, type Timestamp, timestampNow } from "../domain/time";
import {
  type EmailAuthority,
  type ExternalIdentity,
  NAME_MAX_LENGTH,
  normalizeName,
  type User,
} from "../domain/users";
import { deferred } from "../i18n/deferred";
import { isSelectableLocale } from "../i18n/locales";
import type { Translator } from "../i18n/translator";
import { type EventLog, logEvent } from "../log";
import {
  emailAuthority,
  identityPlatformId,
  platformNames,
} from "./email-authority";
import { AppHttpError, badRequest, forbidden } from "./errors";
import {
  createStoredLoginRateLimiter,
  type LoginRateLimiter,
} from "./login-rate-limit";
import type { AppStores, CalendarFeed } from "./stores";
import { createAuthToken, hashAuthToken } from "./tokens";

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;
export const LOGIN_TTL_SECONDS = 60 * 10;

const EMAIL_MAX_LENGTH = 254;

export interface AuthenticatedActor {
  readonly capabilities: readonly PlatformCapabilityGrant[];
  /**
   * Whether the actor staffs any course — a permission fact like the grants
   * above, resolved once per request so that the checks and the views reading
   * it can stay synchronous. See {@link canAuthorContent}, whose answer it is
   * half of.
   */
  readonly isCourseStaff: boolean;
  readonly user: User;
  readonly session: AuthSession;
}

export interface SendLoginEmailInput {
  readonly confirmationUrl: string;
  readonly email: string;
  /**
   * How long the link lives, rather than the instant it dies. An email is the
   * one place the reader's clock is unknowable — there is no browser to ask and
   * no server timezone to fall back on, since a Worker runs wherever the
   * request landed — so an absolute time could only ever be printed in UTC, and
   * a reader in Chicago would have to do arithmetic to learn whether the link
   * in front of them still works. A duration needs no zone, and it pairs with
   * the send time their own mail client already shows them.
   */
  readonly expiresInSeconds: number;
  /**
   * The recipient's language, carried explicitly because there is no account to
   * read a preference from — a login link can be requested by someone who has
   * never signed in. The request's own locale is the best evidence available of
   * what language the person reading the email is using.
   */
  readonly i18n: Translator;
  /** The matching BCP-47 tag, for `Intl` formatting of the lifetime. */
  readonly locale: string;
}

export interface LoginEmailSender {
  send(input: SendLoginEmailInput): Promise<void>;
}

export interface VerifyTurnstileInput {
  /** Forwarded to the verifier as corroborating evidence, never decided on. */
  readonly ipAddress: string | null;
  /** The widget's response token, or null when the form carried none. */
  readonly token: string | null;
}

/**
 * The "prove a person is present" gate on asking for a login email.
 *
 * The per-IP throttle beneath it only stops the trivial single-host script — a
 * botnet walks past any per-IP number, and the address limit protects one
 * mailbox, not our sender reputation. A challenge token per request is the one
 * control that prices mass mailing in money rather than in IP addresses, which
 * is why, where it is configured at all, it applies to every request and not
 * just to suspicious ones: an adaptive challenge keyed on the IP counter would
 * never fire for exactly the distributed attacker it exists for.
 *
 * `verify` throws an {@link AppHttpError} unless the token proves a challenge
 * was passed; the one implementation is Cloudflare Turnstile
 * (`infrastructure/turnstile.ts`).
 */
export interface TurnstileVerifier {
  verify(input: VerifyTurnstileInput): Promise<void>;
}

export interface StartNativeLoginInput {
  readonly email: string;
  readonly ipAddress?: string | null;
  /**
   * The deployment's challenge gate, or null where none is configured.
   *
   * Required on the *input*, not defaulted in the constructor, for the same
   * reason `loginRateLimiter` stopped being skippable: an entry point that can
   * make the server send mail must say out loud what its bot policy is. Both
   * callers pass `turnstileForContext`, which reads the deployment's keys; a
   * new caller that wants no gate has to write `turnstile: null` where a
   * reviewer will see it.
   */
  readonly turnstile: TurnstileVerifier | null;
  /** What the form or JSON body carried; null when the field was absent. */
  readonly turnstileToken: string | null;
}

export interface StartedNativeLogin {
  readonly email: string;
  readonly expiresAt: Timestamp;
  /**
   * The language the *recipient* stored on their account, or null when the
   * address has no account or no recorded preference.
   *
   * Never rendered and never returned to the requester — a login link is asked
   * for from whatever browser is at hand, and the response says the same thing
   * whether or not an account exists. It exists so the mail can be written in
   * the account owner's language rather than the asking browser's, which is the
   * whole reason the preference is stored on the user row at all.
   */
  readonly locale: string | null;
  readonly loginToken: string;
}

export interface ConfirmNativeLoginOptions {
  /**
   * The enrollment link the sign-in started from, when it did. Under the
   * `link_only` registration setting, a valid one is what lets an address with
   * no account create one.
   */
  readonly enrollmentToken?: string | null;
}

/**
 * How a session was earned, for the `sign_in` log line: an email link, an
 * LMS launch, or the link that confirms or undoes an address change.
 */
export type SignInMethod = "email" | "email_change" | "email_undo" | "lti";

export interface MintSessionOptions {
  readonly method: SignInMethod;
  /**
   * Who may frame the session. Absent or null for every sign-in that is not
   * a launch: the session is then framable by nobody but us.
   */
  readonly frameAncestorOrigin?: string | null;
  /**
   * For a launch: the LMS, and its own ID for the user, so the `sign_in` line
   * can be matched against the LMS's logs.
   */
  readonly lms?: { readonly issuer: string; readonly subject: string };
}

/**
 * Where an email sign-in was refused: asking for the link, opening it, or —
 * for any method — at the session itself, which a suspended account cannot
 * have.
 */
type SignInStage = "confirm" | "request" | "session";

export interface MintedSession {
  readonly actor: AuthenticatedActor;
  readonly csrfToken: string;
  readonly sessionToken: string;
}

/**
 * What a consumed login link leads to: a session, or — for an address a
 * recent change moved an account away from — that change's undo, which is the
 * one thing the address still opens. Signing in with it would otherwise make a
 * new, empty account, and take the address the undo needs to give back.
 */
export type ConfirmedNativeLogin =
  | ({ readonly kind: "session" } & MintedSession)
  | { readonly kind: "undo"; readonly undoToken: string };

/** One of the actor's own identities, an LTI one named by its platform. */
export interface OwnAccount {
  /** The account's private calendar feed, or null while it is off. */
  readonly calendarFeed: CalendarFeed | null;
  readonly email: EmailAuthority;
  readonly identities: readonly OwnIdentity[];
}

export interface OwnIdentity extends ExternalIdentity {
  /** The LMS platform's registered name; null for native identities, and
   *  for an LTI identity whose platform has since been deleted. */
  readonly platformName: string | null;
}

export interface UpdateOwnProfileInput {
  /**
   * Which language to render Carnap in, or null to go on following the request.
   * Stored rather than left in a cookie so the choice survives a new browser,
   * and so an emailed login link — sent before any cookie of ours reaches the
   * recipient — can be written in it.
   */
  readonly locale: string | null;
  readonly name: string | null;
  /** Whether the exercise widgets take a key pressed on its own as a shortcut. */
  readonly singleKeyShortcuts: boolean;
}

export interface ActorResolution {
  readonly actor: AuthenticatedActor | null;
  readonly failure: "disabled_user" | null;
}

export interface AuthServiceOptions {
  readonly stores: AppStores;
  /**
   * Override the login throttle. Omitting it does *not* mean "unthrottled": the
   * default is the real limiter over `stores`, so no construction site can
   * forget one. (It used to mean exactly that, and every one of the four sites
   * had — leaving `POST /login` an open mail relay for anyone who found it.)
   */
  readonly loginRateLimiter?: LoginRateLimiter;
  /**
   * Where the `sign_in`, `sign_in_failed` and `sign_out` lines go. Routes pass
   * `requestLog(context)`, which adds the client's address and the request ID.
   */
  readonly log?: EventLog;
  readonly now?: () => Date;
}

/** An address as stored and compared: trimmed and lower-cased. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function assertEmail(email: string): void {
  if (
    email.length === 0 ||
    email.length > EMAIL_MAX_LENGTH ||
    !email.includes("@")
  ) {
    throw badRequest(
      "invalid_email",
      deferred.i18n.t("A valid email address is required."),
    );
  }
}

function assertName(name: string | null): void {
  if (name !== null && name.length > NAME_MAX_LENGTH) {
    throw badRequest(
      "invalid_name",
      deferred.i18n.t("Name must be 200 characters or less."),
    );
  }
}

export class AuthService {
  private readonly loginRateLimiter: LoginRateLimiter;

  constructor(private readonly options: AuthServiceOptions) {
    this.loginRateLimiter =
      options.loginRateLimiter ??
      createStoredLoginRateLimiter(
        options.now === undefined
          ? { auth: options.stores.auth }
          : { auth: options.stores.auth, now: options.now },
      );
  }

  async startNativeLogin(
    input: StartNativeLoginInput,
  ): Promise<StartedNativeLogin> {
    const email = normalizeEmail(input.email);

    try {
      return await this.issueLoginLink(email, input);
    } catch (error) {
      await this.logRefusedSignIn("request", error, email);
      throw error;
    }
  }

  private async issueLoginLink(
    email: string,
    input: StartNativeLoginInput,
  ): Promise<StartedNativeLogin> {
    assertEmail(email);

    // Before the rate limiter, so a botted request is refused by the challenge
    // it cannot answer rather than allowed to spend the shared IP budget —
    // and after `assertEmail`, so garbage input costs no verification call.
    if (input.turnstile !== null) {
      await input.turnstile.verify({
        ipAddress: input.ipAddress ?? null,
        token: input.turnstileToken,
      });
    }

    await this.loginRateLimiter.check({
      email,
      ipAddress: input.ipAddress ?? null,
      // A request that got this far past a configured verifier has answered a
      // challenge, which is what lets the limiter apply the looser IP bound.
      turnstileVerified: input.turnstile !== null,
    });

    const nowDate = this.options.now?.() ?? new Date();
    const createdAt = timestampNow(nowDate);
    const expiresAt = addSeconds(nowDate, LOGIN_TTL_SECONDS);
    const loginToken = createAuthToken("alt");
    const tokenHash = await hashAuthToken(loginToken);

    await this.options.stores.auth.createNativeLoginChallenge({
      id: createAppId(nowDate.getTime()),
      email,
      tokenHash,
      createdAt,
      expiresAt,
    });

    // Only the mailbox owner ever sees the difference this makes: the lookup
    // feeds the email's language and nothing else, so a missing account is
    // indistinguishable from a present one in the response.
    const existing = await this.options.stores.users.getByEmail(email);

    return {
      email,
      expiresAt,
      locale: existing?.locale ?? null,
      loginToken,
    };
  }

  /**
   * The address a login link was sent to, without spending the link. The page
   * the link opens says who it signs in as, and only its button's POST
   * (`confirmNativeLogin`) spends it: mail scanners open links before the
   * reader does, and a GET that signed in would sign the scanner in and leave
   * the reader a used link.
   */
  async describeNativeLogin(token: string): Promise<string> {
    const nowDate = this.options.now?.() ?? new Date();
    const challenge = await this.options.stores.auth.getNativeLoginChallenge(
      await loginLinkHash(token),
      timestampNow(nowDate),
    );

    if (challenge === null) {
      throw invalidLoginLink();
    }

    return challenge.email;
  }

  async confirmNativeLogin(
    token: string,
    options: ConfirmNativeLoginOptions = {},
  ): Promise<ConfirmedNativeLogin> {
    const nowDate = this.options.now?.() ?? new Date();
    // The address the link was sent to, once the link is found, for the
    // refusal line. The session itself is outside the `try`: `mintSession`
    // logs its own refusal.
    let email: string | undefined;
    let user: User;

    try {
      email = await this.consumeLoginLink(token, timestampNow(nowDate));

      const held = await this.reissueHeldAddressUndo(email, nowDate);

      if (held !== null) {
        return { kind: "undo", undoToken: held };
      }

      user = await this.resolveNativeUser(
        email,
        nowDate,
        options.enrollmentToken ?? null,
      );
    } catch (error) {
      await this.logRefusedSignIn("confirm", error, email);
      throw error;
    }

    return {
      kind: "session",
      ...(await this.mintSession(user, { method: "email" })),
    };
  }

  /** Spend a login link, returning the address it was sent to. */
  private async consumeLoginLink(
    token: string,
    now: Timestamp,
  ): Promise<string> {
    const challenge =
      await this.options.stores.auth.consumeNativeLoginChallenge(
        await loginLinkHash(token),
        now,
      );

    if (challenge === null) {
      throw invalidLoginLink();
    }

    return challenge.email;
  }

  /**
   * A fresh undo token for the change that moved an account off `email`, when
   * that change can still be undone and nobody holds the address meanwhile;
   * null otherwise. The token is new because only its hash is stored: the
   * pending link is re-keyed, keeping its expiry, so the old mailbox's holder
   * gains no time by signing in.
   */
  private async reissueHeldAddressUndo(
    email: string,
    nowDate: Date,
  ): Promise<string | null> {
    const { emailChanges, users } = this.options.stores;
    const now = timestampNow(nowDate);

    if (
      (await emailChanges.findPendingUndo(email, now)) === null ||
      (await users.getByEmail(email)) !== null
    ) {
      return null;
    }

    const undoToken = createAuthToken("aemu");
    const reissued = await emailChanges.reissueUndo(
      email,
      await hashAuthToken(undoToken),
      now,
    );

    return reissued === null ? null : undoToken;
  }

  /**
   * Create an application session for a user whose identity has already been
   * proven — by a consumed native login challenge or a validated LTI launch.
   * Every session starts here, so this is where `sign_in` is logged, and where
   * a suspended account's refusal is, whichever way it came.
   *
   * `frameAncestorOrigin` is a property of the session rather than of the
   * user because the same person can hold both kinds at once — an instructor
   * signed in directly in one tab and launched into the LMS in another — and
   * the LMS's permission belongs only to the second.
   */
  async mintSession(
    user: User,
    options: MintSessionOptions,
  ): Promise<MintedSession> {
    if (user.disabledAt !== null) {
      this.log("warn", "sign_in_failed", {
        email: user.email,
        method: options.method,
        reason: "disabled_user",
        stage: "session",
        userId: user.id,
      });

      throw forbidden("disabled_user");
    }

    const nowDate = this.options.now?.() ?? new Date();
    const now = timestampNow(nowDate);
    const sessionToken = createAuthToken("ast");
    const csrfToken = createAuthToken("acsrf");
    const session = await this.options.stores.auth.createSession({
      tokenHash: await hashAuthToken(sessionToken),
      userId: user.id,
      csrfTokenHash: await hashAuthToken(csrfToken),
      createdAt: now,
      expiresAt: addSeconds(nowDate, SESSION_TTL_SECONDS),
      frameAncestorOrigin: options.frameAncestorOrigin ?? null,
    });

    this.log("info", "sign_in", {
      email: user.email,
      issuer: options.lms?.issuer,
      method: options.method,
      subject: options.lms?.subject,
      userId: user.id,
    });

    return {
      actor: await this.actorFor(user, session),
      csrfToken,
      sessionToken,
    };
  }

  async resolveActor(sessionToken: string | null): Promise<ActorResolution> {
    if (sessionToken === null || sessionToken.trim().length === 0) {
      return { actor: null, failure: null };
    }

    const tokenHash = await hashAuthToken(sessionToken);
    const nowDate = this.options.now?.() ?? new Date();
    const session = await this.options.stores.auth.getValidSession(
      tokenHash,
      timestampNow(nowDate),
    );

    if (session === null) {
      return { actor: null, failure: null };
    }

    const user = await this.options.stores.users.getById(session.userId);

    if (user === null) {
      return { actor: null, failure: null };
    }

    if (user.disabledAt !== null) {
      return { actor: null, failure: "disabled_user" };
    }

    return {
      actor: await this.actorFor(user, session),
      failure: null,
    };
  }

  /** End the session `sessionToken` names; `actor` is who held it, if known. */
  async logout(
    sessionToken: string,
    actor: AuthenticatedActor | null,
  ): Promise<void> {
    const tokenHash = await hashAuthToken(sessionToken);
    const nowDate = this.options.now?.() ?? new Date();

    await this.options.stores.auth.revokeSession(
      tokenHash,
      timestampNow(nowDate),
    );

    if (actor !== null) {
      this.log("info", "sign_out", { userId: actor.user.id });
    }
  }

  /**
   * What the profile page shows about the actor's account beyond the user row:
   * the identities that sign in to it (a native email login, plus any LMS
   * links, each named by its platform), who owns its address, and whether
   * its calendar feed is on. No capability check: an actor may always read
   * their own account.
   */
  async describeOwnAccount(actor: AuthenticatedActor): Promise<OwnAccount> {
    const [identities, calendarFeed] = await Promise.all([
      this.options.stores.users.listExternalIdentitiesForUser(actor.user.id),
      this.options.stores.calendarFeeds.getForUser(actor.user.id),
    ]);
    // A platform deleted since linking names nothing; the identity is still
    // listed, and still removable.
    const names = await platformNames(this.options.stores, [
      actor.user.emailSourcePlatformId,
      ...identities.map(identityPlatformId),
    ]);

    return {
      calendarFeed,
      email: emailAuthority(actor.user, identities, names),
      identities: identities.map((identity) => {
        const platformId = identityPlatformId(identity);

        return {
          ...identity,
          platformName:
            platformId === null ? null : (names.get(platformId) ?? null),
        };
      }),
    };
  }

  /**
   * Detach an LMS identity from the actor's own account — the remedy when a
   * launch linked an LMS user the account owner does not recognize. Only LTI
   * identities can go: removing the native identity would orphan the
   * account's email sign-in. The next launch from that LMS re-runs the
   * link-approval flow rather than silently re-attaching.
   */
  async removeOwnIdentity(
    actor: AuthenticatedActor,
    identityId: string,
  ): Promise<void> {
    const identities =
      await this.options.stores.users.listExternalIdentitiesForUser(
        actor.user.id,
      );
    const identity = identities.find((entry) => entry.id === identityId);

    if (identity === undefined) {
      throw new AppHttpError(
        404,
        "identity_not_found",
        deferred.i18n.t("The linked identity was not found on your account."),
      );
    }

    if (identity.provider !== "lti") {
      throw badRequest(
        "identity_not_removable",
        deferred.i18n.t("Email sign-in cannot be removed from an account."),
      );
    }

    await this.options.stores.users.deleteExternalIdentity(identity.id);
  }

  /**
   * Apply the actor's own editable profile fields — everything the profile form
   * carries, saved together. No capability check: an actor may always edit
   * their own profile.
   *
   * The fields are validated before any is written, so a rejected save
   * leaves the row exactly as the form found it rather than applying the half
   * the server happened to like.
   */
  async updateOwnProfile(
    actor: AuthenticatedActor,
    input: UpdateOwnProfileInput,
  ): Promise<User> {
    const name = normalizeName(input.name);

    assertName(name);

    if (input.locale !== null && !isSelectableLocale(input.locale)) {
      throw badRequest(
        "invalid_locale",
        deferred.i18n.t("That language is not available."),
      );
    }

    const nowDate = this.options.now?.() ?? new Date();
    const updated = await this.options.stores.users.updateProfile(
      actor.user.id,
      {
        locale: input.locale,
        name,
        singleKeyShortcuts: input.singleKeyShortcuts,
      },
      timestampNow(nowDate),
    );

    if (updated === null) {
      // Unreachable in practice: the actor's user is loaded from this same row.
      throw new AppHttpError(
        404,
        "user_not_found",
        deferred.i18n.t("The user was not found."),
      );
    }

    return updated;
  }

  /**
   * The user plus everything the request needs to know about what they may do.
   * Both lookups run for every signed-in request, so both are single indexed
   * reads and neither returns more than the permission answer.
   */
  private async actorFor(
    user: User,
    session: AuthSession,
  ): Promise<AuthenticatedActor> {
    const [capabilities, isCourseStaff] = await Promise.all([
      this.capabilitiesForUser(user.id),
      this.options.stores.courses.hasStaffMembership(user.id),
    ]);

    return { capabilities, isCourseStaff, session, user };
  }

  private async capabilitiesForUser(
    userId: string,
  ): Promise<PlatformCapabilityGrant[]> {
    return this.options.stores.platformCapabilities.listActiveForUser(userId);
  }

  /**
   * A new account is created without a name: asking for one on the login
   * form meant an anonymous request chose the name an account was created
   * under, and returning users met a field that was silently ignored. A name
   * is only ever written by its owner, signed in, on /profile. (The
   * challenge table's `name` column is empty and waits for #173.)
   */
  private async resolveNativeUser(
    email: string,
    nowDate: Date,
    enrollmentToken: string | null,
  ): Promise<User> {
    const identity = await this.options.stores.users.getExternalIdentity(
      "native",
      email,
    );

    if (identity !== null) {
      const user = await this.options.stores.users.getById(identity.userId);

      if (user === null) {
        throw new Error("Native identity points at a missing user.");
      }

      return this.withVerifiedEmail(user, nowDate);
    }

    const existingUser = await this.options.stores.users.getByEmail(email);
    const now = timestampNow(nowDate);

    if (existingUser === null) {
      await this.assertRegistrationAllowed(enrollmentToken, now);
    }

    const user =
      existingUser ??
      (await this.options.stores.users.create({
        id: createAppId(nowDate.getTime()),
        email,
        emailVerifiedAt: now,
        name: null,
        createdAt: now,
      }));

    await this.options.stores.users.createExternalIdentity({
      id: createAppId(nowDate.getTime()),
      userId: user.id,
      provider: "native",
      providerSubject: email,
      createdAt: now,
    });

    return this.withVerifiedEmail(user, nowDate);
  }

  private log(...line: Parameters<EventLog>): void {
    (this.options.log ?? logEvent)(...line);
  }

  /**
   * A refused email sign-in, as a `sign_in_failed` line: the address asked
   * for, and the account it belongs to when there is one, so an operator can
   * tell an attack on one person from a typo. Only the reply to the requester
   * must answer every address alike; the log is the operator's. Anything but
   * an `AppHttpError` is a fault, which `request_failed` reports instead.
   */
  private async logRefusedSignIn(
    stage: SignInStage,
    error: unknown,
    email?: string,
  ): Promise<void> {
    if (!(error instanceof AppHttpError)) {
      return;
    }

    // A refused address may be anything a requester typed: keep what fits in
    // an address, and look up only what could be one.
    const address = email?.slice(0, EMAIL_MAX_LENGTH);
    const account =
      address === undefined || error.code === "invalid_email"
        ? null
        : await this.options.stores.users.getByEmail(address);

    this.log("warn", "sign_in_failed", {
      email: address,
      reason: error.code,
      stage,
      userId: account?.id,
    });
  }

  /**
   * Whether an email sign-in from an address with no account may create one,
   * by the instance's `nativeRegistration` setting. Asked only here, after the
   * link was consumed: the login form answers every address alike, so it
   * cannot be used to learn which addresses have accounts, and the one person
   * who learns it here is the mailbox's owner.
   */
  private async assertRegistrationAllowed(
    enrollmentToken: string | null,
    now: Timestamp,
  ): Promise<void> {
    const { nativeRegistration } =
      await this.options.stores.siteSettings.read();

    if (nativeRegistration === "public") {
      return;
    }

    if (nativeRegistration === "link_only" && enrollmentToken !== null) {
      const link = await this.options.stores.courses.getValidEnrollmentLink(
        await hashAuthToken(enrollmentToken),
        now,
      );

      if (link !== null) {
        return;
      }
    }

    throw new AppHttpError(
      403,
      "registration_closed",
      nativeRegistration === "link_only"
        ? deferred.i18n.t(
            "There is no account for this email address. To create one, open the enrollment link your instructor gave you and sign in from there.",
          )
        : deferred.i18n.t(
            "There is no account for this email address. Accounts on this site are created when you open Carnap from your course in your learning management system.",
          ),
    );
  }

  /**
   * Every consumed native login challenge is proof of the mailbox, so it
   * upgrades an address that was so far only asserted — typically an account
   * an LTI launch created — to verified.
   */
  private async withVerifiedEmail(user: User, nowDate: Date): Promise<User> {
    if (user.emailVerifiedAt !== null) {
      return user;
    }

    const verified = await this.options.stores.users.markEmailVerified(
      user.id,
      timestampNow(nowDate),
    );

    return verified ?? user;
  }
}

/** The stored hash of a login link's token, refusing a blank one. */
async function loginLinkHash(token: string): Promise<string> {
  if (token.trim().length === 0) {
    throw badRequest(
      "invalid_login_token",
      deferred.i18n.t("A login token is required."),
    );
  }

  return hashAuthToken(token);
}

function invalidLoginLink(): AppHttpError {
  return new AppHttpError(
    401,
    "invalid_login_token",
    deferred.i18n.t("The login token is invalid or expired."),
  );
}
