import type { PlatformCapabilityGrant } from "../domain/admin";
import type { AuthSession } from "../domain/auth";
import { createAppId } from "../domain/ids";
import { addSeconds, type Timestamp, timestampNow } from "../domain/time";
import {
  type ExternalIdentity,
  NAME_MAX_LENGTH,
  normalizeName,
  type User,
} from "../domain/users";
import { deferred } from "../i18n/deferred";
import { isSelectableLocale } from "../i18n/locales";
import type { Translator } from "../i18n/translator";
import { AppHttpError, badRequest, forbidden } from "./errors";
import {
  createStoredLoginRateLimiter,
  type LoginRateLimiter,
} from "./login-rate-limit";
import type { AppStores } from "./stores";
import { createAuthToken, hashAuthToken } from "./tokens";

export const SESSION_COOKIE_NAME = "carnap_session";
export const CSRF_COOKIE_NAME = "carnap_csrf";
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

export interface StartNativeLoginInput {
  readonly email: string;
  readonly ipAddress?: string | null;
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

export interface MintedSession {
  readonly actor: AuthenticatedActor;
  readonly csrfToken: string;
  readonly sessionToken: string;
}

export type ConfirmedNativeLogin = MintedSession;

export interface UpdateOwnProfileInput {
  /**
   * Which language to render Carnap in, or null to go on following the request.
   * Stored rather than left in a cookie so the choice survives a new browser,
   * and so an emailed login link — sent before any cookie of ours reaches the
   * recipient — can be written in it.
   */
  readonly locale: string | null;
  readonly name: string | null;
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
  readonly now?: () => Date;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function assertEmail(email: string): void {
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

    assertEmail(email);

    await this.loginRateLimiter.check({
      email,
      ipAddress: input.ipAddress ?? null,
    });

    const nowDate = this.options.now?.() ?? new Date();
    const createdAt = timestampNow(nowDate);
    const expiresAt = addSeconds(nowDate, LOGIN_TTL_SECONDS);
    const loginToken = createAuthToken("alt");
    const tokenHash = await hashAuthToken(loginToken);

    await this.options.stores.auth.createNativeLoginChallenge({
      id: createAppId(nowDate.getTime()),
      email,
      // Nothing supplies a name here any more: asking for one on the login form
      // meant an anonymous request chose the name a new account was created
      // under, and returning users met a field that was silently ignored. A
      // name is now only ever written by its owner, signed in, on /profile.
      //
      // The column and the plumbing below stay because a link already in
      // someone's inbox when this shipped still carries one, and it should go
      // on working for the fifteen minutes it has left. Once #173 squashes the
      // migrations to a baseline, the column can go with it.
      name: null,
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

  async confirmNativeLogin(token: string): Promise<ConfirmedNativeLogin> {
    if (token.trim().length === 0) {
      throw badRequest(
        "invalid_login_token",
        deferred.i18n.t("A login token is required."),
      );
    }

    const nowDate = this.options.now?.() ?? new Date();
    const now = timestampNow(nowDate);
    const tokenHash = await hashAuthToken(token);
    const challenge =
      await this.options.stores.auth.consumeNativeLoginChallenge(
        tokenHash,
        now,
      );

    if (challenge === null) {
      throw new AppHttpError(
        401,
        "invalid_login_token",
        deferred.i18n.t("The login token is invalid or expired."),
      );
    }

    const user = await this.resolveNativeUser(
      challenge.email,
      challenge.name,
      nowDate,
    );

    return this.mintSession(user);
  }

  /**
   * Create an application session for a user whose identity has already been
   * proven — by a consumed native login challenge or a validated LTI launch.
   *
   * `frameAncestorOrigin` defaults to null, which is the answer for every
   * sign-in that is not a launch: the session is framable by nobody but us.
   * It is a property of the session rather than of the user because the same
   * person can hold both kinds at once — an instructor signed in directly in
   * one tab and launched into the LMS in another — and the LMS's permission
   * belongs only to the second.
   */
  async mintSession(
    user: User,
    frameAncestorOrigin: string | null = null,
  ): Promise<MintedSession> {
    if (user.disabledAt !== null) {
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
      frameAncestorOrigin,
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

  async logout(sessionToken: string): Promise<void> {
    const tokenHash = await hashAuthToken(sessionToken);
    const nowDate = this.options.now?.() ?? new Date();

    await this.options.stores.auth.revokeSession(
      tokenHash,
      timestampNow(nowDate),
    );
  }

  /**
   * The sign-in methods linked to the actor's own account (a native email
   * login, plus any LMS/LTI links). No capability check: an actor may always
   * read their own identities.
   */
  async listOwnIdentities(
    actor: AuthenticatedActor,
  ): Promise<ExternalIdentity[]> {
    return this.options.stores.users.listExternalIdentitiesForUser(
      actor.user.id,
    );
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
   * Both fields are validated before either is written, so a rejected save
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
      { locale: input.locale, name },
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

  private async resolveNativeUser(
    email: string,
    name: string | null,
    nowDate: Date,
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
    const user =
      existingUser ??
      (await this.options.stores.users.create({
        id: createAppId(nowDate.getTime()),
        email,
        emailVerifiedAt: now,
        name,
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
