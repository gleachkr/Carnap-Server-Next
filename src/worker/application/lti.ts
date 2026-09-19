import {
  type JWTPayload,
  type JWTVerifyGetKey,
  errors as joseErrors,
  jwtVerify,
} from "jose";

import type { Assignment } from "../domain/assignments";
import type { CourseRole } from "../domain/courses";
import { createAppId } from "../domain/ids";
import {
  type LtiPlatform,
  type LtiResourceLink,
  ltiProviderSubject,
} from "../domain/lti";
import { addSeconds, type Timestamp, timestampNow } from "../domain/time";
import {
  normalizeAssertedName,
  normalizeName,
  normalizeStudentId,
  type User,
} from "../domain/users";
import { deferred } from "../i18n/deferred";
import type { SupportedLocale } from "../i18n/locales";
import { matchSupportedLocale } from "../i18n/locales";
import {
  resolveMessage,
  type TranslatableMessage,
  type Translator,
  translateMessage,
} from "../i18n/translator";
import type { AuthenticatedActor, AuthService, MintedSession } from "./auth";
import { requireInstructor } from "./authorization";
import { contentArtifactFromRevision } from "./content/artifact";
import { badRequest, forbidden } from "./errors";
import { planGradeJob, planGradeJobForSubject } from "./grade-passback";
import type { AppStores } from "./stores";
import { createAuthToken, hashAuthToken } from "./tokens";

export const LTI_LOGIN_TTL_SECONDS = 60 * 10;
export const LTI_LINK_TTL_SECONDS = 60 * 60 * 24;
/** How long an instructor has to pick an assignment after a DL launch. */
export const LTI_DEEP_LINK_TTL_SECONDS = 60 * 30;

/**
 * The custom parameter our Deep Linking response plants on the LMS activity.
 * The first launch of that activity carries it back, letting the resource
 * link associate itself with the chosen assignment without an instructor
 * revisiting the picker.
 */
export const CUSTOM_ASSIGNMENT_ID_PARAM = "carnap_assignment_id";

const CLAIM_MESSAGE_TYPE =
  "https://purl.imsglobal.org/spec/lti/claim/message_type";
const CLAIM_VERSION = "https://purl.imsglobal.org/spec/lti/claim/version";
const CLAIM_DEPLOYMENT_ID =
  "https://purl.imsglobal.org/spec/lti/claim/deployment_id";
const CLAIM_RESOURCE_LINK =
  "https://purl.imsglobal.org/spec/lti/claim/resource_link";
const CLAIM_ROLES = "https://purl.imsglobal.org/spec/lti/claim/roles";
const CLAIM_CONTEXT = "https://purl.imsglobal.org/spec/lti/claim/context";
const CLAIM_AGS_ENDPOINT =
  "https://purl.imsglobal.org/spec/lti-ags/claim/endpoint";
const CLAIM_CUSTOM = "https://purl.imsglobal.org/spec/lti/claim/custom";
const CLAIM_LIS = "https://purl.imsglobal.org/spec/lti/claim/lis";
const CLAIM_LAUNCH_PRESENTATION =
  "https://purl.imsglobal.org/spec/lti/claim/launch_presentation";
const CLAIM_DL_SETTINGS =
  "https://purl.imsglobal.org/spec/lti-dl/claim/deep_linking_settings";
const CLAIM_DL_CONTENT_ITEMS =
  "https://purl.imsglobal.org/spec/lti-dl/claim/content_items";
const CLAIM_DL_DATA = "https://purl.imsglobal.org/spec/lti-dl/claim/data";

const MEMBERSHIP_ROLE_PREFIX =
  "http://purl.imsglobal.org/vocab/lis/v2/membership#";
const TEACHING_ASSISTANT_ROLE =
  "http://purl.imsglobal.org/vocab/lis/v2/membership/Instructor#TeachingAssistant";

/**
 * The reserved domain for accounts created from launches that assert no
 * email. `.invalid` is RFC 2606-reserved, so the address can never be routed
 * or claimed, and the user id makes it unique.
 */
const PLACEHOLDER_EMAIL_DOMAIN = "lti.invalid";

/**
 * A launch failure with a message safe to show the person mid-launch and a
 * context object safe to log — identifiers only, never token material.
 */
export class LtiLaunchError extends Error {
  /**
   * The message as a catalog id plus its values, when the thrower wrote one.
   *
   * Every launch failure raised here carries one, and these earn it more than
   * most: `renderLtiError` puts the words straight onto the page a student
   * lands on when a launch from their LMS fails, which is often their first
   * sight of Carnap and never somewhere they can navigate away from usefully.
   */
  readonly translatable: TranslatableMessage | undefined;

  constructor(
    readonly code: string,
    /**
     * English prose, or a {@link deferred} message carrying the same English
     * as a catalog id. `Error.message` ends up the same either way, so the
     * `lti_launch_failed` log line and anything reading `logContext` beside it
     * cannot tell the difference.
     */
    message: string | TranslatableMessage,
    readonly logContext: Record<string, string | null> = {},
  ) {
    super(typeof message === "string" ? message : resolveMessage(message));
    this.name = "LtiLaunchError";
    this.translatable = typeof message === "string" ? undefined : message;
  }

  /**
   * The message worded for a viewer — what the launch-failure page shows.
   * Falls back to `message`, which is the English the thrower wrote.
   */
  localize(i18n: Translator): string {
    return this.translatable === undefined
      ? this.message
      : translateMessage(this.translatable, i18n);
  }
}

/**
 * Resolves the key material used to verify a platform's id_tokens. The
 * production resolver (`infrastructure/lti/platform-keys.ts`) fetches the
 * platform's JWKS over the network; tests inject a local key set so launches
 * stay hermetic.
 */
export type LtiPlatformKeyResolver = (
  platform: LtiPlatform,
) => JWTVerifyGetKey;

export interface BeginLtiLoginInput {
  readonly issuer: string;
  readonly clientId: string | null;
  readonly loginHint: string;
  readonly ltiMessageHint: string | null;
  /** The absolute URL of our launch endpoint, derived from the request. */
  readonly launchUrl: string;
}

export interface HandleLtiLaunchInput {
  readonly state: string;
  readonly idToken: string;
  /**
   * The browser origin the launch arrived from, which is the origin that will
   * be framing us, recorded on the session this launch mints. Required rather
   * than optional: a caller that forgot it would mint a session no LMS may
   * frame, and the launch would fail as a blank iframe with the reason only in
   * the reader's console. See `routes/lti.ts`, which derives it.
   */
  readonly frameAncestorOrigin: string | null;
}

/**
 * The language the platform says it is speaking, on the outcomes that continue
 * into a browsing session. A *hint*, so the route only acts on it when the
 * browser has expressed no preference of its own; null when the launch named no
 * language we serve.
 */
interface LaunchedLocale {
  readonly locale: SupportedLocale | null;
}

export type LtiLaunchOutcome =
  | (LaunchedLocale & {
      readonly kind: "session";
      readonly redirectPath: string;
      readonly session: MintedSession;
    })
  | (LaunchedLocale & {
      /**
       * A Deep Linking request from an instructor: the launch response is
       * the assignment picker, and `selectionToken` (single-use, short TTL)
       * keys the platform's return URL and opaque data server-side.
       */
      readonly kind: "deep-linking";
      readonly courseId: string;
      readonly selectionToken: string;
      readonly session: MintedSession;
    })
  | (LaunchedLocale & {
      /**
       * The launch asserted an email that belongs to an existing account, so
       * no session is minted until the account owner approves the link via
       * the token emailed to that address. `linkToken` is null when an
       * earlier launch already created a still-pending challenge.
       */
      readonly kind: "link-pending";
      readonly email: string;
      readonly expiresAt: Timestamp;
      readonly linkToken: string | null;
      /**
       * The account owner's stored language, or null when they have recorded
       * none. Unlike every other outcome the recipient here is *known* — the
       * challenge is addressed to an existing account — so the confirmation
       * mail can be written in their language rather than in whatever the
       * browser at the LMS happened to ask for.
       */
      readonly recipientLocale: string | null;
    });

export interface ConfirmedLtiLink {
  readonly email: string;
  readonly platformName: string;
}

export interface LtiServiceOptions {
  readonly stores: AppStores;
  readonly auth: AuthService;
  /** Injected, never defaulted: the network lives in `infrastructure/`. */
  readonly keyResolver: LtiPlatformKeyResolver;
  readonly now?: () => Date;
  readonly requestId?: string;
}

interface NormalizedLaunch {
  readonly agsLineItemUrl: string | null;
  readonly context: {
    readonly id: string;
    readonly label: string | null;
    readonly title: string | null;
  } | null;
  /** Our own Deep Linking custom parameter, echoed back by the platform. */
  readonly customAssignmentId: string | null;
  readonly email: string | null;
  /**
   * The language the LMS is showing this reader, narrowed to one we serve — a
   * hint, not a preference, so it only seeds a browser with no locale cookie yet.
   */
  readonly locale: SupportedLocale | null;
  readonly name: string | null;
  readonly resourceLink: {
    readonly id: string;
    readonly title: string | null;
  } | null;
  readonly role: CourseRole;
  /**
   * The institution's identifier for this person, normalized — see
   * {@link studentIdClaim} for where a platform may put it. Null is the common
   * case and carries no consequence: nothing here depends on having one.
   */
  readonly studentId: string | null;
  readonly subject: string;
}

function stringClaim(payload: JWTPayload, key: string): string | null {
  const value = payload[key];

  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * `launch_presentation.locale` — the language the LMS is rendering its own
 * chrome in — mapped onto a locale we serve, or null when it names none. A
 * platform may send a full tag (`de-AT`), a tag we do not have, or nothing.
 */
function localeClaim(payload: JWTPayload): SupportedLocale | null {
  const claimed = stringField(
    objectClaim(payload, CLAIM_LAUNCH_PRESENTATION),
    "locale",
  );

  return claimed === null ? null : matchSupportedLocale(claimed);
}

/**
 * A whitespace-only email claim must normalize to null, not "": an empty
 * string would skip the placeholder path and collide on the email unique
 * index the second time a platform sends one.
 */
function normalizedEmailClaim(payload: JWTPayload): string | null {
  const email = stringClaim(payload, "email")?.trim().toLowerCase() ?? null;

  return email !== null && email.length > 0 ? email : null;
}

/**
 * The launching person's name: the `name` claim, or the given and family names
 * composed when a platform sends only the parts.
 *
 * Bounded here rather than at the adopter, for the reason
 * {@link normalizeAssertedName} gives — the account-creating insert carries this
 * value to the column without passing an adopter at all.
 */
function nameClaim(payload: JWTPayload): string | null {
  const givenName = stringClaim(payload, "given_name");
  const familyName = stringClaim(payload, "family_name");
  const composedName =
    givenName !== null || familyName !== null
      ? [givenName, familyName].filter((part) => part !== null).join(" ")
      : null;

  return normalizeAssertedName(stringClaim(payload, "name") ?? composedName);
}

/**
 * The institution's identifier for the launching person: `lis.person_sourcedid`
 * and nothing else.
 *
 * A custom parameter looks like the obvious fallback for the platforms that do
 * not send this claim, and was built and then removed. The `custom` claim is
 * not an administrator-only channel — LTI allows custom parameters at the link
 * placement as well as at tool registration, and the launch presents both
 * identically, so we cannot tell which we are reading. Proven against Moodle:
 * an ordinary course teacher, editing the activity through the normal form,
 * can set the parameter and thereby write a permanent, unalterable identifier
 * onto every student who launches it — all of them the same value, shown to
 * each student as having come from their institution. A field whose whole
 * purpose is to match an institutional record cannot be sourced from a channel
 * the institution does not control.
 *
 * Should a platform turn up that really withholds the claim, the way back is an
 * opt-in on the {@link LtiPlatform} registration, so that a Carnap site admin
 * makes the trust decision the claim itself cannot carry.
 *
 * Normalized here rather than at the adopter so that every route to the column
 * — this and the account-creating insert alike — is bounded and blank-free by
 * construction.
 */
function studentIdClaim(payload: JWTPayload): string | null {
  return normalizeStudentId(
    stringField(objectClaim(payload, CLAIM_LIS), "person_sourcedid"),
  );
}

function objectClaim(
  payload: JWTPayload,
  key: string,
): Record<string, unknown> | null {
  const value = payload[key];

  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(
  record: Record<string, unknown> | null,
  key: string,
): string | null {
  if (record === null) {
    return null;
  }

  const value = record[key];

  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Map the launch's LIS context roles onto a course role. Only context-level
 * membership roles count: institution- and system-scoped roles say what the
 * person is at the institution, not what they are in this course. The
 * TeachingAssistant sub-role is checked first because platforms typically
 * send it alongside a plain Instructor role. Unrecognized roles fall to
 * student — the platform demonstrably granted the person course access, and
 * student is the least privilege we can express.
 */
export function mapLtiRolesToCourseRole(
  roles: readonly string[],
): CourseRole {
  const names = new Set<string>();

  for (const role of roles) {
    if (role === TEACHING_ASSISTANT_ROLE) {
      return "teacher_assistant";
    }

    if (role.startsWith(MEMBERSHIP_ROLE_PREFIX)) {
      names.add(role.slice(MEMBERSHIP_ROLE_PREFIX.length));
    } else if (!role.includes("://")) {
      // Bare simple names are the spec's short form for context roles.
      names.add(role);
    }
  }

  if (names.has("Instructor") || names.has("Administrator")) {
    return "instructor";
  }

  // A content developer designs the course in the LMS, which here is a
  // teaching assistant's authoring without an instructor's run of the roster
  // and the assignments. A later launch never rewrites a role set inside
  // Carnap, so an instructor can promote them from the members table.
  if (names.has("ContentDeveloper")) {
    return "teacher_assistant";
  }

  return "student";
}

export class LtiService {
  constructor(private readonly options: LtiServiceOptions) {}

  /**
   * Handle an OIDC third-party login initiation: validate the platform,
   * record a state/nonce pair, and build the authorization redirect.
   */
  async beginLogin(input: BeginLtiLoginInput): Promise<{
    readonly redirectUrl: string;
  }> {
    const platform = await this.resolvePlatform(input.issuer, input.clientId);
    const nowDate = this.options.now?.() ?? new Date();
    const state = createAuthToken("lst");
    const nonce = createAuthToken("lnn");

    await this.options.stores.lti.createLoginState({
      stateHash: await hashAuthToken(state),
      nonceHash: await hashAuthToken(nonce),
      platformId: platform.id,
      createdAt: timestampNow(nowDate),
      expiresAt: addSeconds(nowDate, LTI_LOGIN_TTL_SECONDS),
    });

    const url = new URL(platform.authorizationEndpoint);

    url.searchParams.set("response_type", "id_token");
    url.searchParams.set("response_mode", "form_post");
    url.searchParams.set("scope", "openid");
    url.searchParams.set("prompt", "none");
    url.searchParams.set("client_id", platform.clientId);
    url.searchParams.set("redirect_uri", input.launchUrl);
    url.searchParams.set("state", state);
    url.searchParams.set("nonce", nonce);
    url.searchParams.set("login_hint", input.loginHint);

    if (input.ltiMessageHint !== null) {
      url.searchParams.set("lti_message_hint", input.ltiMessageHint);
    }

    return { redirectUrl: url.href };
  }

  /**
   * Validate a launch id_token and convert it into ordinary Carnap records:
   * an external identity and user, a course and membership, a resource-link
   * record, and finally a normal application session. Raw claims never leave
   * this method.
   */
  async handleLaunch(input: HandleLtiLaunchInput): Promise<LtiLaunchOutcome> {
    const nowDate = this.options.now?.() ?? new Date();
    const now = timestampNow(nowDate);
    const stateRow = await this.options.stores.lti.consumeLoginState(
      await hashAuthToken(input.state),
      now,
    );

    if (stateRow === null) {
      throw new LtiLaunchError(
        "lti_state_invalid",
        deferred.i18n.t(
          "This launch has expired or was already used. Return to your course and launch again.",
        ),
      );
    }

    const platform = await this.options.stores.lti.getPlatformById(
      stateRow.platformId,
    );

    if (platform === null || platform.disabledAt !== null) {
      throw new LtiLaunchError(
        "lti_platform_unavailable",
        deferred.i18n.t("This LMS connection is not available."),
        { platformId: stateRow.platformId },
      );
    }

    const payload = await this.verifyToken(input.idToken, platform);

    const nonce = stringClaim(payload, "nonce");

    if (
      nonce === null ||
      (await hashAuthToken(nonce)) !== stateRow.nonceHash
    ) {
      throw new LtiLaunchError(
        "lti_nonce_mismatch",
        deferred.i18n.t(
          "This launch could not be verified. Return to your course and launch again.",
        ),
        { issuer: platform.issuer },
      );
    }

    const messageType = stringClaim(payload, CLAIM_MESSAGE_TYPE);

    if (
      messageType !== "LtiResourceLinkRequest" &&
      messageType !== "LtiDeepLinkingRequest"
    ) {
      throw new LtiLaunchError(
        "lti_message_type_unsupported",
        deferred.i18n.t("This kind of LMS message is not supported."),
        { issuer: platform.issuer, messageType },
      );
    }

    const version = stringClaim(payload, CLAIM_VERSION);

    if (version !== "1.3.0") {
      throw new LtiLaunchError(
        "lti_version_unsupported",
        deferred.i18n.t("Only LTI 1.3 launches are supported."),
        { issuer: platform.issuer, version },
      );
    }

    const deploymentId = stringClaim(payload, CLAIM_DEPLOYMENT_ID);

    if (deploymentId === null) {
      throw new LtiLaunchError(
        "lti_deployment_missing",
        deferred.i18n.t("The launch did not identify its LMS deployment."),
        { issuer: platform.issuer },
      );
    }

    const deployment = await this.options.stores.lti.getDeployment(
      platform.id,
      deploymentId,
    );

    if (deployment === null) {
      throw new LtiLaunchError(
        "lti_deployment_unknown",
        deferred.i18n.t(
          'This LMS deployment is not registered with Carnap. Ask your Carnap administrator to register deployment "{deploymentId}".',
          { deploymentId },
        ),
        { issuer: platform.issuer, deploymentId },
      );
    }

    const launch = this.normalizeLaunch(payload, platform);

    // Everything below works exclusively with the normalized launch and
    // ordinary domain records.
    const identityOutcome = await this.resolveUser(launch, platform, nowDate);

    if (identityOutcome.kind === "link-pending") {
      return identityOutcome;
    }

    const user = identityOutcome.user;

    if (user.disabledAt !== null) {
      throw new LtiLaunchError(
        "lti_user_disabled",
        deferred.i18n.t("Your Carnap account is disabled."),
        { issuer: platform.issuer },
      );
    }

    const courseId = await this.resolveCourse(
      launch,
      deployment.id,
      user,
      nowDate,
    );
    const role = await this.resolveMembership(
      launch,
      courseId,
      user,
      nowDate,
    );

    if (messageType === "LtiDeepLinkingRequest") {
      return this.beginDeepLinking(
        payload,
        platform,
        deployment.id,
        courseId,
        role,
        user,
        nowDate,
        input.frameAncestorOrigin,
      );
    }

    const redirectPath = await this.resolveRedirect(
      launch,
      deployment.id,
      courseId,
      role,
      user.id,
      nowDate,
    );
    const session = await this.options.auth.mintSession(
      user,
      input.frameAncestorOrigin,
    );

    return { kind: "session", locale: launch.locale, redirectPath, session };
  }

  /**
   * A Deep Linking request: validate the platform's selection settings,
   * stash the return URL and opaque `data` behind a single-use token, and
   * mint the session the picker page's form will act under. Selection is an
   * authoring act, so it takes an instructor-level role in the Carnap course
   * — whatever the launch claims said.
   */
  private async beginDeepLinking(
    payload: JWTPayload,
    platform: LtiPlatform,
    deploymentRowId: string,
    courseId: string,
    role: CourseRole,
    user: User,
    nowDate: Date,
    frameAncestorOrigin: string | null,
  ): Promise<LtiLaunchOutcome> {
    if (role !== "instructor") {
      throw new LtiLaunchError(
        "lti_deep_linking_forbidden",
        deferred.i18n.t(
          "Only course instructors can choose Carnap content from the LMS.",
        ),
        { issuer: platform.issuer },
      );
    }

    const settings = objectClaim(payload, CLAIM_DL_SETTINGS);
    const returnUrl = stringField(settings, "deep_link_return_url");

    if (returnUrl === null) {
      throw new LtiLaunchError(
        "lti_deep_linking_invalid",
        deferred.i18n.t(
          "The LMS sent a content selection request without a return address.",
        ),
        { issuer: platform.issuer },
      );
    }

    const acceptTypes = settings?.accept_types;

    if (
      !Array.isArray(acceptTypes) ||
      !acceptTypes.includes("ltiResourceLink")
    ) {
      throw new LtiLaunchError(
        "lti_deep_linking_unsupported_types",
        deferred.i18n.t(
          "The LMS does not accept activity links from this selection, which is the only content Carnap provides.",
        ),
        { issuer: platform.issuer },
      );
    }

    const selectionToken = createAuthToken("ldl");
    const now = timestampNow(nowDate);

    await this.options.stores.lti.createDeepLinkRequest({
      tokenHash: await hashAuthToken(selectionToken),
      platformId: platform.id,
      deploymentId: deploymentRowId,
      courseId,
      userId: user.id,
      returnUrl,
      data: stringField(settings, "data"),
      createdAt: now,
      expiresAt: addSeconds(nowDate, LTI_DEEP_LINK_TTL_SECONDS),
    });

    const session = await this.options.auth.mintSession(
      user,
      frameAncestorOrigin,
    );

    return {
      kind: "deep-linking",
      courseId,
      locale: localeClaim(payload),
      selectionToken,
      session,
    };
  }

  /**
   * Describe a still-pending link challenge without consuming it, so the
   * confirmation page can say what will be linked before the person commits.
   */
  async describeLinkChallenge(token: string): Promise<ConfirmedLtiLink> {
    const nowDate = this.options.now?.() ?? new Date();
    const challenge = await this.options.stores.lti.getLinkChallenge(
      await hashAuthToken(token),
      timestampNow(nowDate),
    );

    if (challenge === null) {
      throw invalidLinkError();
    }

    const platform = await this.requireLinkablePlatform(challenge.platformId);

    return { email: challenge.email, platformName: platform.name };
  }

  /**
   * Consume an emailed link-approval token and attach the pending LTI
   * identity to the account it targets.
   */
  async confirmLink(token: string): Promise<ConfirmedLtiLink> {
    const nowDate = this.options.now?.() ?? new Date();
    const now = timestampNow(nowDate);
    const challenge = await this.options.stores.lti.consumeLinkChallenge(
      await hashAuthToken(token),
      now,
    );

    if (challenge === null) {
      throw invalidLinkError();
    }

    const platform = await this.requireLinkablePlatform(challenge.platformId);
    const user = await this.options.stores.users.getById(challenge.userId);

    if (user === null || user.disabledAt !== null) {
      throw new LtiLaunchError(
        "lti_user_disabled",
        deferred.i18n.t("The Carnap account this link targets is disabled."),
        { platformId: challenge.platformId },
      );
    }

    await this.createIdentity(
      challenge.userId,
      ltiProviderSubject(challenge.platformId, challenge.subject),
      nowDate,
    );

    // The launch that opened this challenge may have carried a name, and the
    // account it just attached to may have none — the commonest case being an
    // account that reached Carnap by email before its LMS ever launched into
    // it. Same rule as a launch: fill a blank, overwrite nothing.
    //
    // Only the name: a challenge records what it needs to identify the pending
    // link, and a student ID is not part of that. Nothing is lost, because the
    // identity now exists and the person's next launch — the one that follows
    // this approval — adopts the ID through the ordinary path.
    await this.adoptAssertedProfile(
      user,
      { name: challenge.name, studentId: null },
      nowDate,
    );

    // The approval token went to the account's address, so clicking it is
    // also proof of that mailbox.
    await this.options.stores.users.markEmailVerified(challenge.userId, now);

    return { email: challenge.email, platformName: platform.name };
  }

  /**
   * Withdraw a just-created link challenge whose confirmation email could not
   * be delivered, so the person's next launch mints a fresh one instead of
   * pointing at an email that never arrived.
   */
  async cancelLinkChallenge(token: string): Promise<void> {
    await this.options.stores.lti.deleteLinkChallenge(
      await hashAuthToken(token),
    );
  }

  /**
   * A challenge outlives the launch that created it, so linking re-checks
   * that the platform still exists and was not disabled in the meantime —
   * disabling a platform must also stop its in-flight link approvals.
   */
  private async requireLinkablePlatform(
    platformId: string,
  ): Promise<LtiPlatform> {
    const platform =
      await this.options.stores.lti.getPlatformById(platformId);

    if (platform === null || platform.disabledAt !== null) {
      throw new LtiLaunchError(
        "lti_platform_unavailable",
        deferred.i18n.t("This LMS connection is not available."),
        { platformId },
      );
    }

    return platform;
  }

  /**
   * LMS activities that launched into this course but are not yet attached
   * to an assignment, for the instructor's association picker.
   */
  async listUnmappedResourceLinks(
    actor: AuthenticatedActor,
    courseId: string,
  ): Promise<LtiResourceLink[]> {
    await requireInstructor(this.options.stores, actor, courseId);

    return this.options.stores.lti.listUnmappedResourceLinksForCourse(
      courseId,
    );
  }

  /**
   * Attach a seen-but-unmapped LMS resource link to an assignment so later
   * launches of that LMS activity land directly on it.
   */
  async associateResourceLink(
    actor: AuthenticatedActor,
    courseId: string,
    resourceLinkRowId: string,
    assignmentId: string,
  ): Promise<LtiResourceLink> {
    await requireInstructor(this.options.stores, actor, courseId);

    const link =
      await this.options.stores.lti.getResourceLinkById(resourceLinkRowId);
    const linkContext =
      link === null
        ? null
        : await this.options.stores.lti.getContextById(link.contextId);

    if (link === null || linkContext === null) {
      throw badRequest(
        "lti_resource_link_not_found",
        deferred.i18n.t("The LMS activity link was not found."),
      );
    }

    if (linkContext.courseId !== courseId) {
      throw forbidden("lti_resource_link_not_in_course");
    }

    const assignment =
      await this.options.stores.assignments.getById(assignmentId);

    if (assignment === null || assignment.courseId !== courseId) {
      throw badRequest(
        "invalid_assignment",
        deferred.i18n.t("The assignment was not found in this course."),
      );
    }

    const nowDate = this.options.now?.() ?? new Date();

    // Re-pointing a mapped link changes what its LMS column means: queued
    // sends still describe the old assignment and must not land in it.
    if (link.assignmentId !== null && link.assignmentId !== assignment.id) {
      await this.options.stores.lti.deleteGradeJobsForResourceLink(link.id);
    }

    const updated = await this.options.stores.lti.setResourceLinkAssignment(
      link.id,
      assignment.id,
      timestampNow(nowDate),
    );

    if (updated === null) {
      throw badRequest(
        "lti_resource_link_not_found",
        deferred.i18n.t("The LMS activity link was not found."),
      );
    }

    await this.backfillGradeJobsForLink(
      updated,
      assignment,
      linkContext.deploymentId,
      nowDate,
    );

    return updated;
  }

  /**
   * Students may have earned scores before the LMS activity was attached to
   * the assignment, so association queues a passback for every score already
   * on the books. Ongoing changes are queued by the gradebook's score writes.
   */
  private async backfillGradeJobsForLink(
    link: LtiResourceLink,
    assignment: Assignment,
    deploymentRowId: string,
    nowDate: Date,
  ): Promise<void> {
    if (
      link.agsLineItemUrl === null ||
      link.assignmentId === null ||
      assignment.assessmentMode !== "graded"
    ) {
      return;
    }

    const deploymentRow =
      await this.options.stores.lti.getDeploymentById(deploymentRowId);

    if (deploymentRow === null) {
      return;
    }

    const now = timestampNow(nowDate);
    const scores = await this.options.stores.scores.listAssignmentScores(
      link.assignmentId,
    );

    if (scores.length === 0) {
      return;
    }

    // The class's subjects in one read and its jobs in a few writes: this
    // runs inside the association request, whose statement budget must not
    // scale with the roster.
    const subjects = await this.options.stores.users.listLtiSubjects(
      scores.map((score) => score.userId),
      deploymentRow.platformId,
    );
    const jobs = scores.flatMap((score) => {
      const job = planGradeJobForSubject(
        {
          assignment,
          link,
          platformId: deploymentRow.platformId,
          score,
          // A backfill has no idea what the LMS column already shows, so
          // fresh "missing" zeros stay unpublished.
          previousStatus: null,
          now,
        },
        subjects.get(score.userId) ?? null,
      );

      return job === null ? [] : [job];
    });

    await this.options.stores.lti.enqueueGradeJobs(jobs);
  }

  /**
   * Consume a Deep Linking selection token and build the unsigned response
   * claims. A null `assignmentId` is the instructor backing out: the
   * response then carries no content items, which tells the platform to
   * change nothing. Signing stays with the caller — the tool key never
   * enters the application layer.
   */
  async prepareDeepLinkResponse(
    actor: AuthenticatedActor,
    selectionToken: string,
    assignmentId: string | null,
    launchUrl: string,
  ): Promise<{
    readonly claims: Record<string, unknown>;
    readonly returnUrl: string;
  }> {
    const nowDate = this.options.now?.() ?? new Date();
    const now = timestampNow(nowDate);
    const tokenHash = await hashAuthToken(selectionToken);
    // Validation runs against a peek; the single-use consumption is the last
    // step, so a correctable failure (a stale assignment choice, say) leaves
    // the token alive for the instructor's next try.
    const request = await this.options.stores.lti.getDeepLinkRequest(
      tokenHash,
      now,
    );

    // The token was minted for the launching instructor's fresh session;
    // any other session replaying it gets the same answer as an expired one.
    if (request === null || request.userId !== actor.user.id) {
      throw new LtiLaunchError(
        "lti_deep_link_selection_invalid",
        deferred.i18n.t(
          "This content selection has expired or was already completed. Start again from your LMS.",
        ),
      );
    }

    await requireInstructor(this.options.stores, actor, request.courseId);

    const platform = await this.requireLinkablePlatform(request.platformId);
    const deployment = await this.options.stores.lti.getDeploymentById(
      request.deploymentId,
    );

    if (deployment === null) {
      throw new LtiLaunchError(
        "lti_platform_unavailable",
        deferred.i18n.t("This LMS connection is not available."),
        { platformId: request.platformId },
      );
    }

    const contentItems: Record<string, unknown>[] = [];

    if (assignmentId !== null) {
      const assignment =
        await this.options.stores.assignments.getById(assignmentId);

      if (assignment === null || assignment.courseId !== request.courseId) {
        throw badRequest(
          "invalid_assignment",
          deferred.i18n.t("The assignment was not found in this course."),
        );
      }

      const item: Record<string, unknown> = {
        type: "ltiResourceLink",
        title: assignment.title,
        url: launchUrl,
        custom: { [CUSTOM_ASSIGNMENT_ID_PARAM]: assignment.id },
      };
      const points = await this.assignmentNominalPoints(assignment);

      // Declaring the line item makes the platform create the gradebook
      // column itself; launches then hand us its URL via the AGS claim.
      if (assignment.assessmentMode === "graded" && points > 0) {
        item.lineItem = {
          label: assignment.title,
          resourceId: assignment.id,
          scoreMaximum: points,
        };
      }

      contentItems.push(item);
    }

    const claims: Record<string, unknown> = {
      iss: platform.clientId,
      aud: platform.issuer,
      nonce: crypto.randomUUID(),
      [CLAIM_MESSAGE_TYPE]: "LtiDeepLinkingResponse",
      [CLAIM_VERSION]: "1.3.0",
      [CLAIM_DEPLOYMENT_ID]: deployment.deploymentId,
      [CLAIM_DL_CONTENT_ITEMS]: contentItems,
    };

    // The opaque data value must round-trip exactly when present.
    if (request.data !== null) {
      claims[CLAIM_DL_DATA] = request.data;
    }

    // Consume atomically now that the response is fully built: of two
    // concurrent submissions, exactly one gets to answer the platform.
    const consumed = await this.options.stores.lti.consumeDeepLinkRequest(
      tokenHash,
      now,
    );

    if (consumed === null) {
      throw new LtiLaunchError(
        "lti_deep_link_selection_invalid",
        deferred.i18n.t(
          "This content selection has expired or was already completed. Start again from your LMS.",
        ),
      );
    }

    return { claims, returnUrl: request.returnUrl };
  }

  /** The assignment's total points, from its content revision's manifest. */
  private async assignmentNominalPoints(
    assignment: Assignment,
  ): Promise<number> {
    const revision = await this.options.stores.content.getRevision(
      assignment.contentRevisionId,
    );

    if (revision === null) {
      return 0;
    }

    // Refusing the selection is the point. This used to be a fifth hand-rolled
    // artifact reader that answered 0 for anything it could not make sense of,
    // and 0 points here does not read as an error — it reads as an ungraded
    // assignment, so the `lineItem` is omitted, the LMS creates an activity
    // with no gradebook column, and no score can ever be passed back to it.
    // An instructor would find that out weeks later, with the work already
    // done. Failing the deep link now is recoverable; that is not.
    return contentArtifactFromRevision(revision).manifest.reduce(
      (sum, item) => sum + item.nominalPoints,
      0,
    );
  }

  private async resolvePlatform(
    issuer: string,
    clientId: string | null,
  ): Promise<LtiPlatform> {
    const platform =
      clientId !== null
        ? await this.options.stores.lti.getPlatformByIssuerClientId(
            issuer,
            clientId,
          )
        : await this.onlyPlatformForIssuer(issuer);

    if (platform === null || platform.disabledAt !== null) {
      throw new LtiLaunchError(
        "lti_platform_unknown",
        deferred.i18n.t("This LMS is not registered with Carnap."),
        { issuer, clientId },
      );
    }

    return platform;
  }

  private async onlyPlatformForIssuer(
    issuer: string,
  ): Promise<LtiPlatform | null> {
    const platforms =
      await this.options.stores.lti.listPlatformsByIssuer(issuer);

    // Without a client_id hint, the issuer must identify the registration
    // unambiguously; guessing between clients would validate the launch
    // against the wrong audience.
    return platforms.length === 1 ? (platforms[0] ?? null) : null;
  }

  private async verifyToken(
    idToken: string,
    platform: LtiPlatform,
  ): Promise<JWTPayload> {
    try {
      const { payload } = await jwtVerify(
        idToken,
        this.options.keyResolver(platform),
        {
          algorithms: ["RS256"],
          audience: platform.clientId,
          clockTolerance: 60,
          issuer: platform.issuer,
        },
      );

      // The authorized party, when asserted, must be us; and with genuinely
      // multiple audiences it must be asserted, or a token minted for
      // another tool on the same platform would replay here. A single-element
      // aud array (Moodle's shape) needs no azp.
      const azp = stringClaim(payload, "azp");
      const multiAudience =
        Array.isArray(payload.aud) && payload.aud.length > 1;

      if (
        (azp !== null && azp !== platform.clientId) ||
        (multiAudience && azp === null)
      ) {
        throw new LtiLaunchError(
          "lti_wrong_audience",
          deferred.i18n.t("This launch was not issued for Carnap."),
          { issuer: platform.issuer },
        );
      }

      return payload;
    } catch (error) {
      throw this.launchErrorFromJose(error, platform);
    }
  }

  private launchErrorFromJose(
    error: unknown,
    platform: LtiPlatform,
  ): LtiLaunchError | Error {
    if (error instanceof LtiLaunchError) {
      return error;
    }

    const logContext = { issuer: platform.issuer };

    if (error instanceof joseErrors.JWTExpired) {
      return new LtiLaunchError(
        "lti_token_expired",
        deferred.i18n.t(
          "This launch has expired. Return to your course and launch again.",
        ),
        logContext,
      );
    }

    if (error instanceof joseErrors.JWTClaimValidationFailed) {
      if (error.claim === "iss") {
        return new LtiLaunchError(
          "lti_wrong_issuer",
          deferred.i18n.t("This launch came from an unexpected LMS."),
          logContext,
        );
      }

      if (error.claim === "aud") {
        return new LtiLaunchError(
          "lti_wrong_audience",
          deferred.i18n.t("This launch was not issued for Carnap."),
          logContext,
        );
      }

      return new LtiLaunchError(
        "lti_invalid_token",
        deferred.i18n.t("This launch could not be verified."),
        { ...logContext, claim: error.claim },
      );
    }

    if (error instanceof joseErrors.JOSEError) {
      return new LtiLaunchError(
        "lti_invalid_signature",
        deferred.i18n.t("This launch could not be verified."),
        { ...logContext, reason: error.code },
      );
    }

    return error instanceof Error ? error : new Error(String(error));
  }

  private normalizeLaunch(
    payload: JWTPayload,
    platform: LtiPlatform,
  ): NormalizedLaunch {
    const subject = stringClaim(payload, "sub");

    if (subject === null) {
      throw new LtiLaunchError(
        "lti_subject_missing",
        deferred.i18n.t("The launch did not identify a user."),
        { issuer: platform.issuer },
      );
    }

    const rolesValue = payload[CLAIM_ROLES];
    const roles = Array.isArray(rolesValue)
      ? rolesValue.filter((role): role is string => typeof role === "string")
      : [];
    const contextClaim = objectClaim(payload, CLAIM_CONTEXT);
    const contextId = stringField(contextClaim, "id");
    const resourceLinkClaim = objectClaim(payload, CLAIM_RESOURCE_LINK);
    const resourceLinkId = stringField(resourceLinkClaim, "id");

    return {
      agsLineItemUrl: stringField(
        objectClaim(payload, CLAIM_AGS_ENDPOINT),
        "lineitem",
      ),
      context:
        contextId === null
          ? null
          : {
              id: contextId,
              label: stringField(contextClaim, "label"),
              title: stringField(contextClaim, "title"),
            },
      customAssignmentId: stringField(
        objectClaim(payload, CLAIM_CUSTOM),
        CUSTOM_ASSIGNMENT_ID_PARAM,
      ),
      email: normalizedEmailClaim(payload),
      locale: localeClaim(payload),
      name: nameClaim(payload),
      resourceLink:
        resourceLinkId === null
          ? null
          : {
              id: resourceLinkId,
              title: stringField(resourceLinkClaim, "title"),
            },
      role: mapLtiRolesToCourseRole(roles),
      studentId: studentIdClaim(payload),
      subject,
    };
  }

  private async resolveUser(
    launch: NormalizedLaunch,
    platform: LtiPlatform,
    nowDate: Date,
  ): Promise<
    | { readonly kind: "user"; readonly user: User }
    | Extract<LtiLaunchOutcome, { kind: "link-pending" }>
  > {
    const subject = ltiProviderSubject(platform.id, launch.subject);
    const identity = await this.options.stores.users.getExternalIdentity(
      "lti",
      subject,
    );

    if (identity !== null) {
      const user = await this.options.stores.users.getById(identity.userId);

      if (user === null) {
        throw new Error("LTI identity points at a missing user.");
      }

      return {
        kind: "user",
        user: await this.adoptAssertedProfile(user, launch, nowDate),
      };
    }

    if (launch.email !== null) {
      const existing = await this.options.stores.users.getByEmail(
        launch.email,
      );

      if (existing !== null) {
        return this.beginLinkChallenge(launch, platform, existing, nowDate);
      }
    }

    // Deliberate trust boundary: attaching to an EXISTING account requires
    // the emailed approval above, but a brand-new account is created from
    // the platform's email assertion as-is. A registered platform vouching
    // for its users' addresses is the premise of LTI identity; anyone who
    // later signs in natively still proves the mailbox via the login link.
    const now = timestampNow(nowDate);
    const userId = createAppId(nowDate.getTime());

    let user: User;

    try {
      user = await this.options.stores.users.create({
        id: userId,
        email: launch.email ?? `lti-${userId}@${PLACEHOLDER_EMAIL_DOMAIN}`,
        // Asserted, not proven: verification happens when the person first
        // signs in natively (or approves a link) via that mailbox.
        emailVerifiedAt: null,
        name: launch.name,
        studentId: launch.studentId,
        createdAt: now,
      });
    } catch (error) {
      // A concurrent launch may have claimed the email between our reads and
      // this insert — usually the same person double-launching. Re-resolving
      // settles the race either way: same subject lands on the winner's
      // identity; a different subject falls into the link-challenge flow.
      const racedIdentity =
        await this.options.stores.users.getExternalIdentity("lti", subject);

      if (racedIdentity !== null) {
        const racedUser = await this.options.stores.users.getById(
          racedIdentity.userId,
        );

        if (racedUser === null) {
          throw new Error("LTI identity points at a missing user.");
        }

        return {
          kind: "user",
          user: await this.adoptAssertedProfile(racedUser, launch, nowDate),
        };
      }

      const racedByEmail =
        launch.email === null
          ? null
          : await this.options.stores.users.getByEmail(launch.email);

      if (racedByEmail === null) {
        throw error;
      }

      return this.beginLinkChallenge(launch, platform, racedByEmail, nowDate);
    }

    await this.createIdentity(user.id, subject, nowDate);

    return { kind: "user", user };
  }

  /**
   * Fill in whatever this account is still missing that the platform asserts —
   * its name, its student ID — leaving anything already recorded alone.
   *
   * The assertions a launch carries used to reach the row only at creation,
   * which left two populations permanently incomplete: accounts made by a
   * launch from a platform that was not sharing a field at the time, and
   * accounts that existed before their LMS identity was linked to them. Both
   * show up in every roster and gradebook as a bare email address — often a
   * placeholder one — and neither can be repaired by relaunching. The prompt
   * that would ask them to fix it themselves is no help either: it does not
   * render on the chrome-free pages a launch lands on.
   *
   * Filling only a blank is what makes this safe to run on every launch. It is
   * not the hole that taking the name off the login form closed — a launch is a
   * signed assertion from a registered platform, not an anonymous form post —
   * but a name the account holder chose is still theirs, and a platform that
   * disagrees with it does not get to win.
   *
   * One method for both fields rather than one per field, because the whole
   * bug being fixed here is a write that reaches some of the paths a launch can
   * take and not others: there are four, and they are easy to add a fifth to.
   * The argument is structural so that a {@link NormalizedLaunch} satisfies it
   * as-is and the link-approval path, which has only a name to offer, can say
   * so in a literal.
   *
   * The two fields follow two rules, split by who owns the fact. A name is
   * the account holder's: a launch fills a blank and never writes over a
   * value, because a platform that disagrees with a name its owner chose
   * does not get to win. A student ID is the institution's: the latest
   * launch wins, because the platform speaking for the institution is the
   * fresher source, and — with no form for the value anywhere — "correct it
   * in the LMS and relaunch" is the only repair a wrong ID can have.
   */
  private async adoptAssertedProfile(
    user: User,
    asserted: {
      readonly name: string | null;
      readonly studentId: string | null;
    },
    nowDate: Date,
  ): Promise<User> {
    return this.adoptAssertedStudentId(
      await this.adoptAssertedName(user, asserted.name, nowDate),
      asserted.studentId,
      nowDate,
    );
  }

  private async adoptAssertedName(
    user: User,
    asserted: string | null,
    nowDate: Date,
  ): Promise<User> {
    const name = normalizeAssertedName(asserted);

    // The length bound is `normalizeAssertedName`'s and not this method's: a
    // launch that creates an account never arrives here, so a test that lived
    // only here left that path storing whatever the platform sent.
    //
    // The `normalizeName(user.name)` half is a fast path and not the rule —
    // the blank test `adoptName` carries in its `WHERE` clause is what
    // decides, so an owner saving their profile between our read and this
    // write keeps the name they typed. (Read through the shape normalizer
    // rather than `hasName`, whose narrowing would type `user` `never` here.)
    if (name === null || normalizeName(user.name) !== null) {
      return user;
    }

    const updated = await this.options.stores.users.adoptName(
      user.id,
      name,
      timestampNow(nowDate),
    );

    return updated ?? user;
  }

  /**
   * The institution's rule rather than the name's: `adoptStudentId` writes
   * whenever the stored value differs, so the latest launch's assertion is
   * what a grade export shows. A registrar correcting an ID fixes Carnap by
   * relaunching — confirmed unfixable under the old fill-once rule, which
   * kept the stale value silently and offered no repair anywhere else.
   *
   * The column is one per account, not one per platform, so a person
   * launched from two institutions' LMSes would see the two assertions take
   * turns. Accepted knowingly: that person may not exist, and if they turn
   * up, the escape is scoping the ID onto `external_identities`, which
   * already keys one row per platform.
   *
   * `normalizeStudentId` returning null covers both nothing-asserted and
   * too-long-to-store, so a launch asserting nothing never erases a stored
   * ID; over-long is dropped rather than truncated because a truncated
   * institutional ID still looks like one in a grade export.
   */
  private async adoptAssertedStudentId(
    user: User,
    asserted: string | null,
    nowDate: Date,
  ): Promise<User> {
    const studentId = normalizeStudentId(asserted);

    // The equality half is a fast path and not the rule: it saves an update
    // that would match no rows on every launch whose ID is already current,
    // which is most of them after the first. Deleting it would change nothing
    // but the query count — the `WHERE` clause is what decides.
    if (studentId === null || user.studentId === studentId) {
      return user;
    }

    const updated = await this.options.stores.users.adoptStudentId(
      user.id,
      studentId,
      timestampNow(nowDate),
    );

    return updated ?? user;
  }

  private async beginLinkChallenge(
    launch: NormalizedLaunch,
    platform: LtiPlatform,
    user: User,
    nowDate: Date,
  ): Promise<Extract<LtiLaunchOutcome, { kind: "link-pending" }>> {
    if (launch.email === null) {
      throw new Error("Link challenges require an asserted email.");
    }

    const now = timestampNow(nowDate);
    const pending = await this.options.stores.lti.getPendingLinkChallenge(
      platform.id,
      launch.subject,
      user.id,
      now,
    );

    // An unexpired challenge from an earlier launch is still in the person's
    // inbox; repeating the launch must not turn into repeated emails.
    if (pending !== null) {
      return {
        kind: "link-pending",
        email: pending.email,
        expiresAt: pending.expiresAt,
        linkToken: null,
        locale: launch.locale,
        recipientLocale: user.locale,
      };
    }

    const linkToken = createAuthToken("llt");
    const expiresAt = addSeconds(nowDate, LTI_LINK_TTL_SECONDS);

    await this.options.stores.lti.createLinkChallenge({
      tokenHash: await hashAuthToken(linkToken),
      platformId: platform.id,
      subject: launch.subject,
      email: launch.email,
      name: launch.name,
      userId: user.id,
      createdAt: now,
      expiresAt,
    });

    return {
      kind: "link-pending",
      email: launch.email,
      expiresAt,
      linkToken,
      locale: launch.locale,
      recipientLocale: user.locale,
    };
  }

  private async createIdentity(
    userId: string,
    subject: string,
    nowDate: Date,
  ): Promise<void> {
    try {
      await this.options.stores.users.createExternalIdentity({
        id: createAppId(nowDate.getTime()),
        userId,
        provider: "lti",
        providerSubject: subject,
        createdAt: timestampNow(nowDate),
      });
    } catch (error) {
      // A concurrent launch or a second confirmation click may have created
      // the identity already; the unique index makes the race harmless.
      const existing = await this.options.stores.users.getExternalIdentity(
        "lti",
        subject,
      );

      if (existing === null || existing.userId !== userId) {
        throw error;
      }
    }
  }

  private async resolveCourse(
    launch: NormalizedLaunch,
    deploymentRowId: string,
    user: User,
    nowDate: Date,
  ): Promise<string> {
    if (launch.context === null) {
      throw new LtiLaunchError(
        "lti_context_missing",
        deferred.i18n.t("The launch did not identify a course."),
      );
    }

    const existing = await this.options.stores.lti.getContext(
      deploymentRowId,
      launch.context.id,
    );

    if (existing !== null) {
      return existing.courseId;
    }

    if (launch.role !== "instructor") {
      throw new LtiLaunchError(
        "lti_course_not_ready",
        deferred.i18n.t(
          "This course has not been set up in Carnap yet. Ask your instructor to open it from the LMS first.",
        ),
      );
    }

    const now = timestampNow(nowDate);
    const course = await this.options.stores.courses.create({
      id: createAppId(nowDate.getTime()),
      title: launch.context.title ?? launch.context.label ?? "LTI course",
      timezone: "UTC",
      createdById: user.id,
      createdAt: now,
    });

    try {
      await this.options.stores.lti.createContext({
        id: createAppId(nowDate.getTime()),
        deploymentId: deploymentRowId,
        contextId: launch.context.id,
        courseId: course.id,
        createdAt: now,
      });
    } catch (error) {
      // A concurrent first launch won the unique index; use its mapping and
      // abandon our just-created course rather than failing the person.
      const raced = await this.options.stores.lti.getContext(
        deploymentRowId,
        launch.context.id,
      );

      if (raced === null) {
        throw error;
      }

      return raced.courseId;
    }

    // Course creation is otherwise capability-gated; here it rides on the
    // platform's say-so that the person is an instructor, so leave admins a
    // trail of what each registered LMS created.
    await this.options.stores.adminAudit.append({
      action: "lti.course_created",
      actorUserId: user.id,
      createdAt: now,
      id: createAppId(nowDate.getTime()),
      metadata: {
        contextId: launch.context.id,
        deploymentId: deploymentRowId,
        title: course.title,
      },
      requestId: this.options.requestId ?? "",
      targetCourseId: course.id,
      targetUserId: user.id,
    });

    return course.id;
  }

  private async resolveMembership(
    launch: NormalizedLaunch,
    courseId: string,
    user: User,
    nowDate: Date,
  ): Promise<CourseRole> {
    const existing = await this.options.stores.courses.getMembership(
      courseId,
      user.id,
    );

    if (existing !== null) {
      // The launch proves the person's identity, so an invited membership
      // can activate; but a role or status set inside Carnap is otherwise
      // authoritative — later launches never rewrite it.
      if (existing.status === "invited") {
        await this.options.stores.courses.updateMembershipStatus({
          courseId,
          membershipId: existing.id,
          status: "active",
          updatedAt: timestampNow(nowDate),
        });

        return existing.role;
      }

      if (existing.status !== "active") {
        throw new LtiLaunchError(
          "lti_membership_inactive",
          deferred.i18n.t("Your enrollment in this course is not active."),
        );
      }

      return existing.role;
    }

    try {
      await this.options.stores.courses.addMembership({
        id: createAppId(nowDate.getTime()),
        courseId,
        userId: user.id,
        role: launch.role,
        status: "active",
        createdAt: timestampNow(nowDate),
      });
    } catch (error) {
      const raced = await this.options.stores.courses.getMembership(
        courseId,
        user.id,
      );

      if (raced === null) {
        throw error;
      }

      return raced.role;
    }

    return launch.role;
  }

  private async resolveRedirect(
    launch: NormalizedLaunch,
    deploymentRowId: string,
    courseId: string,
    role: CourseRole,
    userId: string,
    nowDate: Date,
  ): Promise<string> {
    if (launch.context === null || launch.resourceLink === null) {
      return `/courses/${courseId}`;
    }

    const context = await this.options.stores.lti.getContext(
      deploymentRowId,
      launch.context.id,
    );

    if (context === null) {
      return `/courses/${courseId}`;
    }

    const existing = await this.options.stores.lti.getResourceLink(
      context.id,
      launch.resourceLink.id,
    );
    let link = await this.options.stores.lti.upsertResourceLink({
      id: createAppId(nowDate.getTime()),
      contextId: context.id,
      resourceLinkId: launch.resourceLink.id,
      title: launch.resourceLink.title ?? "",
      agsLineItemUrl: launch.agsLineItemUrl,
      now: timestampNow(nowDate),
    });
    let backfilled = false;

    // An activity created through Deep Linking carries our custom parameter
    // naming the chosen assignment, so its first launch completes the
    // association the instructor already made in the picker.
    if (link.assignmentId === null && launch.customAssignmentId !== null) {
      const assignment = await this.options.stores.assignments.getById(
        launch.customAssignmentId,
      );

      if (assignment !== null && assignment.courseId === courseId) {
        const mapped =
          await this.options.stores.lti.setResourceLinkAssignment(
            link.id,
            assignment.id,
            timestampNow(nowDate),
          );

        if (mapped !== null) {
          await this.backfillGradeJobsForLink(
            mapped,
            assignment,
            deploymentRowId,
            nowDate,
          );
          link = mapped;
          backfilled = true;
        }
      }
    }

    if (link.assignmentId === null) {
      return `/courses/${courseId}`;
    }

    if (!backfilled && link.agsLineItemUrl !== null) {
      if (existing === null || existing.agsLineItemUrl === null) {
        // This launch delivered the gradebook column for an activity that
        // was associated before the column existed: every score already on
        // the books is owed to it now.
        const assignment = await this.options.stores.assignments.getById(
          link.assignmentId,
        );

        if (assignment !== null) {
          await this.backfillGradeJobsForLink(
            link,
            assignment,
            deploymentRowId,
            nowDate,
          );
        }
      } else {
        // Cheap per-launch self-heal: a student whose LTI identity appeared
        // after the association's backfill (a confirmed link challenge, say)
        // has a stable score no change will ever push — queue it the first
        // time they arrive through the LMS.
        await this.selfHealGradeJob(link, deploymentRowId, userId, nowDate);
      }
    }

    // A student's launch lands on the content itself rather than on the
    // assignment page. A launch names one resource — the link is singular, and
    // a line item is bound to it — so the page's navigation leads nowhere the
    // LMS knows about: a course here holds assignments the LMS has never heard
    // of, and work done on one of those is scored in our gradebook and can
    // never reach theirs. The content view is also the surface the author's CSS
    // governs, and one frame shallower inside a container the LMS makes short.
    // The route sends a graded assignment with no attempt open to its gate.
    //
    // The instructor's launch keeps the assignment page: they are not there to
    // do the work but to look after it, and the settings, gradebook and content
    // links are the point of arriving.
    return role === "instructor"
      ? `/courses/${courseId}/instructor/assignments/${link.assignmentId}`
      : `/courses/${courseId}/assignments/${link.assignmentId}/content`;
  }

  private async selfHealGradeJob(
    link: LtiResourceLink,
    deploymentRowId: string,
    userId: string,
    nowDate: Date,
  ): Promise<void> {
    if (link.assignmentId === null || link.agsLineItemUrl === null) {
      return;
    }

    // A job row in any state — even complete — means this student's sync is
    // already being tracked; only a student the outbox has never heard of
    // needs healing.
    const existingJob = await this.options.stores.lti.getGradeJob(
      link.id,
      userId,
    );

    if (existingJob !== null) {
      return;
    }

    const score = await this.options.stores.scores.getAssignmentScore(
      link.assignmentId,
      userId,
    );

    if (score === null) {
      return;
    }

    const assignment = await this.options.stores.assignments.getById(
      link.assignmentId,
    );
    const deploymentRow =
      assignment === null
        ? null
        : await this.options.stores.lti.getDeploymentById(deploymentRowId);

    if (assignment === null || deploymentRow === null) {
      return;
    }

    const job = await planGradeJob(this.options.stores, {
      assignment,
      link,
      platformId: deploymentRow.platformId,
      score,
      previousStatus: null,
      now: timestampNow(nowDate),
    });

    if (job !== null) {
      await this.options.stores.lti.enqueueGradeJob(job);
    }
  }
}

export function invalidLinkError(): LtiLaunchError {
  return new LtiLaunchError(
    "lti_link_invalid",
    deferred.i18n.t(
      "This confirmation link is invalid or has expired. Launch from your LMS again to receive a new one.",
    ),
  );
}
