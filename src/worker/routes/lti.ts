import { type Context, Hono } from "hono";
import { SignJWT } from "jose";

import { AuthService } from "../application/auth";
import { requireAuthenticated } from "../application/authorization";
import { AppHttpError } from "../application/errors";
import { GradePassbackService } from "../application/grade-passback";
import {
  defaultLtiKeyResolver,
  invalidLinkError,
  LTI_LINK_TTL_SECONDS,
  LtiLaunchError,
  LtiService,
} from "../application/lti";
import { hasLocaleCookie, setLocaleCookie } from "../cookies";
import type { AppBindings } from "../http";
import { i18nFor, isSupportedLocale } from "../i18n";
import { deferred } from "../i18n/deferred";
import { ltiLinkEmailSenderFromEnv } from "../infrastructure/email/resend";
import { loadLtiToolKey } from "../infrastructure/lti/tool-key";
import { applyLocale } from "../middleware/locale";
import { allowFrameAncestor } from "../middleware/security-headers";
import { kickGradePassback } from "../passback";
import { storesForContext } from "../stores";
import { renderFormError } from "../web/errors";
import { fieldValue, redirect } from "../web/html";
import {
  renderLtiDeepLinkReturn,
  renderLtiDeepLinkSelect,
  renderLtiError,
  renderLtiLinkConfirm,
  renderLtiLinkConfirmed,
  renderLtiLinkPending,
} from "../web/lti";
import { setSessionCookies } from "./session-cookies";

export function ltiServiceForContext(
  context: Context<AppBindings>,
): LtiService {
  const stores = storesForContext(context);

  return new LtiService({
    auth: new AuthService({ stores }),
    keyResolver: context.get("ltiKeyResolver") ?? defaultLtiKeyResolver,
    requestId: context.get("requestId"),
    stores,
  });
}

/**
 * Render a failed launch as a standalone HTML page. Launches are browser
 * navigations from an LMS, so the JSON error envelope is never appropriate
 * here. The structured log line carries identifiers only — never the
 * id_token or its claims.
 */
function renderLaunchFailure(
  context: Context<AppBindings>,
  error: unknown,
): Response {
  if (error instanceof LtiLaunchError) {
    console.error("lti_launch_failed", {
      code: error.code,
      requestId: context.get("requestId"),
      ...error.logContext,
    });

    return renderLtiError(context, {
      code: error.code,
      message: error.localize(context.get("i18n")),
      status: 400,
    });
  }

  if (error instanceof AppHttpError) {
    console.error("lti_launch_failed", {
      code: error.code,
      requestId: context.get("requestId"),
    });

    return renderLtiError(context, {
      code: error.code,
      message: error.localize(context.get("i18n")),
      status: error.status,
    });
  }

  throw error;
}

interface LoginInitiation {
  readonly clientId: string | null;
  readonly issuer: string | null;
  readonly loginHint: string | null;
  readonly ltiMessageHint: string | null;
}

function initiationFromParams(params: URLSearchParams): LoginInitiation {
  return {
    clientId: params.get("client_id"),
    issuer: params.get("iss"),
    loginHint: params.get("login_hint"),
    ltiMessageHint: params.get("lti_message_hint"),
  };
}

/** The origin of an absolute URL, or null if it is not one we can read. */
function originOf(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }

  try {
    const { origin } = new URL(value);

    // A sandboxed or otherwise opaque origin serializes as the literal `null`,
    // which is a value in a `frame-ancestors` list rather than an absence — and
    // one that would match any opaque origin, including an attacker's own
    // sandboxed frame. Treat it as knowing nothing.
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

/**
 * The browser origin this launch was navigated from: the origin that is about
 * to frame us, and so the only foreign origin our `frame-ancestors` names.
 *
 * Taken from the request rather than from the platform registration, because
 * this is the browser's question and only the browser has answered it. A
 * platform's `issuer` looks like the same fact and is not: on the hosted LMSes
 * it is a vendor constant — every Canvas in the world issues
 * `https://canvas.instructure.com` — so trusting it would name an origin that
 * frames nobody while missing the school's own, which is the one that does.
 *
 * `Origin` is what a browser sends on the cross-origin form POST that carries a
 * launch, so the launch proper is covered. `Referer` is the fallback for the
 * OIDC initiation, which may arrive as a GET navigation and so without an
 * `Origin` at all; there it only affects whether a failure page is legible
 * inside the frame. Null when we can read neither, which forfeits a framed
 * launch — the honest outcome, since the alternative is guessing at who may
 * frame us.
 */
function launchFrameAncestor(context: Context<AppBindings>): string | null {
  return (
    originOf(context.req.header("Origin")) ??
    originOf(context.req.header("Referer"))
  );
}

async function handleLoginInitiation(
  context: Context<AppBindings>,
  initiation: LoginInitiation,
): Promise<Response> {
  // Nothing here renders in the frame but a failure page; the launch that
  // follows records the durable answer on its session.
  allowFrameAncestor(context, launchFrameAncestor(context));

  try {
    if (initiation.issuer === null || initiation.loginHint === null) {
      throw new LtiLaunchError(
        "lti_login_invalid",
        deferred.i18n.t("The login request from the LMS was incomplete."),
        { issuer: initiation.issuer },
      );
    }

    const begun = await ltiServiceForContext(context).beginLogin({
      clientId: initiation.clientId,
      issuer: initiation.issuer,
      launchUrl: new URL("/lti/launch", context.req.url).href,
      loginHint: initiation.loginHint,
      ltiMessageHint: initiation.ltiMessageHint,
    });

    return context.redirect(begun.redirectUrl, 302);
  } catch (error) {
    return renderLaunchFailure(context, error);
  }
}

export const ltiRoutes = new Hono<AppBindings>();

ltiRoutes.get("/login", (context) =>
  handleLoginInitiation(
    context,
    initiationFromParams(new URL(context.req.url).searchParams),
  ),
);

ltiRoutes.post("/login", async (context) => {
  const form = await context.req.raw.formData();
  const params = new URLSearchParams();

  for (const [key, value] of form.entries()) {
    if (typeof value === "string") {
      params.set(key, value);
    }
  }

  return handleLoginInitiation(context, initiationFromParams(params));
});

/**
 * Take the language the LMS says it is speaking — but only for a reader who has
 * expressed no preference of ours yet.
 *
 * Someone reading Carnap in English inside a German Moodle has chosen that, and
 * a launch is not the place to overrule it. A signed-in user's stored preference
 * outranks this cookie anyway; this is for the common case of a student whose
 * first sight of Carnap is through the LMS.
 *
 * The cookie alone would be a request too late. A Deep Linking launch answers
 * with the picker page *in this response*, so without `applyLocale` it would
 * render in the pre-launch language and only the page after it would be German.
 * (`applyLocale` still lets a stored preference win, so a signed-in reader's
 * language does not flicker to the platform's for one page.)
 */
function adoptLaunchLocale(
  context: Context<AppBindings>,
  locale: string | null,
): void {
  if (locale !== null && !hasLocaleCookie(context)) {
    setLocaleCookie(context, locale);
    applyLocale(context, locale);
  }
}

ltiRoutes.post("/launch", async (context) => {
  // Read before anything can throw, and applied to this response as well as
  // stored on the session: the picker, the link prompt and the failure page are
  // all rendered right here, in the LMS's iframe, by a browser that has not yet
  // sent us back the cookie that would otherwise answer the question.
  const frameAncestorOrigin = launchFrameAncestor(context);

  allowFrameAncestor(context, frameAncestorOrigin);

  try {
    const form = await context.req.raw.formData();
    const state = fieldValue(form.get("state"));
    const idToken = fieldValue(form.get("id_token"));
    const oidcError = fieldValue(form.get("error"));

    // A platform that refuses the authentication request form_posts an OIDC
    // error code instead of an id_token; naming it beats "incomplete".
    if (oidcError.length > 0) {
      throw new LtiLaunchError(
        "lti_platform_refused",
        deferred.i18n.t(
          "The LMS declined the launch ({oidcError}). Try launching again from the LMS.",
          { oidcError },
        ),
        { oidcError },
      );
    }

    if (state.length === 0 || idToken.length === 0) {
      throw new LtiLaunchError(
        "lti_launch_invalid",
        deferred.i18n.t("The launch from the LMS was incomplete."),
      );
    }

    const outcome = await ltiServiceForContext(context).handleLaunch({
      frameAncestorOrigin,
      idToken,
      state,
    });

    if (outcome.kind === "link-pending") {
      // The account-link prompt is rendered in *this* response, like the Deep
      // Linking picker — so the launch's language has to be applied before it,
      // not merely cookied for a next request that may never come.
      adoptLaunchLocale(context, outcome.locale);

      // The await matters: returning the bare promise would skip this
      // handler's catch and turn an email failure into a JSON 500.
      return await respondLinkPending(context, outcome);
    }

    if (outcome.kind === "deep-linking") {
      adoptLaunchLocale(context, outcome.locale);

      return await respondDeepLinking(context, outcome);
    }

    // Lax survives the top-level redirect that follows, but the session must
    // also work when the LMS embeds Carnap in an iframe, which needs None.
    setSessionCookies(
      context,
      outcome.session.sessionToken,
      outcome.session.csrfToken,
      { sameSite: "None" },
    );
    adoptLaunchLocale(context, outcome.locale);

    // The launch may have backfilled grade jobs (a fresh association or a
    // newly delivered line item); start draining them now.
    kickGradePassback(context);

    return context.redirect(outcome.redirectPath, 303);
  } catch (error) {
    return renderLaunchFailure(context, error);
  }
});

/**
 * Answer a Deep Linking launch with the assignment picker. The selection
 * POST authenticates by session cookie and proves intent with the
 * single-use selection token; the route is CSRF-exempt, so the picker
 * survives a session rotation with a clean error instead of a bare 403.
 */
async function respondDeepLinking(
  context: Context<AppBindings>,
  outcome: {
    readonly courseId: string;
    readonly selectionToken: string;
    readonly session: {
      readonly csrfToken: string;
      readonly sessionToken: string;
    };
  },
): Promise<Response> {
  // Fail now, not after the instructor picks: without a signing key the
  // selection could never be sent back to the LMS.
  if ((await loadLtiToolKey(context.env.LTI_TOOL_PRIVATE_KEY)) === null) {
    throw new LtiLaunchError(
      "lti_tool_key_missing",
      deferred.i18n.t(
        "Carnap has no signing key configured, so content selection cannot complete. Contact your Carnap administrator.",
      ),
    );
  }

  setSessionCookies(
    context,
    outcome.session.sessionToken,
    outcome.session.csrfToken,
    { sameSite: "None" },
  );

  const assignments = await storesForContext(
    context,
  ).assignments.listForCourse(outcome.courseId);

  return renderLtiDeepLinkSelect(context, {
    assignments,
    selectionToken: outcome.selectionToken,
  });
}

ltiRoutes.post("/deep-link/respond", async (context) => {
  try {
    const actor = context.get("actor");

    if (actor === null) {
      throw new LtiLaunchError(
        "lti_deep_link_session_missing",
        deferred.i18n.t(
          "Your session has expired. Start the content selection again from your LMS.",
        ),
      );
    }

    const form = await context.req.raw.formData();
    const token = fieldValue(form.get("token"));
    const assignmentId = fieldValue(form.get("assignmentId"));

    if (token.length === 0) {
      throw new LtiLaunchError(
        "lti_deep_link_selection_invalid",
        deferred.i18n.t(
          "This content selection has expired or was already completed. Start again from your LMS.",
        ),
      );
    }

    const toolKey = await loadLtiToolKey(context.env.LTI_TOOL_PRIVATE_KEY);

    if (toolKey === null) {
      throw new LtiLaunchError(
        "lti_tool_key_missing",
        deferred.i18n.t(
          "Carnap has no signing key configured, so content selection cannot complete. Contact your Carnap administrator.",
        ),
      );
    }

    const prepared = await ltiServiceForContext(
      context,
    ).prepareDeepLinkResponse(
      actor,
      token,
      assignmentId.length === 0 ? null : assignmentId,
      new URL("/lti/launch", context.req.url).href,
    );
    const header: { alg: string; kid?: string } = { alg: toolKey.alg };

    if (toolKey.kid !== undefined) {
      header.kid = toolKey.kid;
    }

    const jwt = await new SignJWT(prepared.claims)
      .setProtectedHeader(header)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(toolKey.key);

    return renderLtiDeepLinkReturn(context, {
      jwt,
      returnUrl: prepared.returnUrl,
    });
  } catch (error) {
    return renderLaunchFailure(context, error);
  }
});

/**
 * The language to write the account-link confirmation in.
 *
 * The recipient is not a stranger here: the challenge exists precisely because
 * the launch named an address that already has an account, so their stored
 * preference is the best answer available and outranks anything this request
 * carries. Failing that, the LMS's own language — a first-time reader arriving
 * from a German Moodle has no cookie and no stored choice, and the browser's
 * `Accept-Language` is the weakest evidence of the three.
 */
function linkEmailLocale(
  context: Context<AppBindings>,
  outcome: {
    readonly locale: string | null;
    readonly recipientLocale: string | null;
  },
): string {
  const stored = outcome.recipientLocale;

  if (stored !== null && isSupportedLocale(stored)) {
    return stored;
  }

  return outcome.locale ?? context.get("language");
}

async function respondLinkPending(
  context: Context<AppBindings>,
  outcome: {
    readonly email: string;
    readonly linkToken: string | null;
    readonly locale: string | null;
    readonly recipientLocale: string | null;
  },
): Promise<Response> {
  // A null token means an earlier launch already emailed a still-valid link;
  // showing the same page again without re-sending is the whole point.
  if (outcome.linkToken === null) {
    return renderLtiLinkPending(context, {
      email: outcome.email,
      localConfirmUrl: null,
    });
  }

  const confirmUrl = new URL("/lti/link/confirm", context.req.url);

  confirmUrl.searchParams.set("token", outcome.linkToken);

  const sender = ltiLinkEmailSenderFromEnv(context.env);

  if (sender === null) {
    if (context.env.CARNAP_ENV === "local") {
      return renderLtiLinkPending(context, {
        email: outcome.email,
        localConfirmUrl: confirmUrl.href,
      });
    }

    // The challenge row was already stored; leaving it would make every
    // later launch claim an email was sent when none ever can be.
    await ltiServiceForContext(context).cancelLinkChallenge(
      outcome.linkToken,
    );

    throw new LtiLaunchError(
      "lti_link_email_not_configured",
      deferred.i18n.t(
        "Carnap cannot send the account-link confirmation email in this environment. Contact your Carnap administrator.",
      ),
    );
  }

  const emailLocale = linkEmailLocale(context, outcome);

  try {
    await sender.send({
      confirmationUrl: confirmUrl.href,
      email: outcome.email,
      expiresInSeconds: LTI_LINK_TTL_SECONDS,
      i18n: i18nFor(emailLocale),
      locale: emailLocale,
    });
  } catch (error) {
    // Withdraw the undelivered challenge so the next launch retries the
    // email instead of pointing at a message that never arrived.
    await ltiServiceForContext(context).cancelLinkChallenge(
      outcome.linkToken,
    );

    throw error;
  }

  return renderLtiLinkPending(context, {
    email: outcome.email,
    localConfirmUrl: null,
  });
}

// Opening the emailed URL must not change anything: email scanners prefetch
// GETs, and a prefetch that completed the link would approve it without the
// account owner's consent. The GET only shows what would be linked; the
// button's POST does the linking.
ltiRoutes.get("/link/confirm", async (context) => {
  try {
    const token = new URL(context.req.url).searchParams.get("token");

    if (token === null || token.length === 0) {
      throw invalidLinkError();
    }

    const pending =
      await ltiServiceForContext(context).describeLinkChallenge(token);

    return renderLtiLinkConfirm(context, { ...pending, token });
  } catch (error) {
    return renderLaunchFailure(context, error);
  }
});

ltiRoutes.post("/link/confirm", async (context) => {
  try {
    const form = await context.req.raw.formData();
    const token = fieldValue(form.get("token"));

    if (token.length === 0) {
      throw invalidLinkError();
    }

    const confirmed = await ltiServiceForContext(context).confirmLink(token);

    return renderLtiLinkConfirmed(context, confirmed);
  } catch (error) {
    return renderLaunchFailure(context, error);
  }
});

ltiRoutes.post("/resource-links/:linkId/assignment", async (context) => {
  const actor = requireAuthenticated(context);
  const form = await context.req.raw.formData();
  const courseId = fieldValue(form.get("courseId"));
  const assignmentId = fieldValue(form.get("assignmentId"));

  try {
    await ltiServiceForContext(context).associateResourceLink(
      actor,
      courseId,
      context.req.param("linkId"),
      assignmentId,
    );

    // Association may have backfilled grade jobs for existing scores.
    kickGradePassback(context);

    return redirect(`/courses/${courseId}?ltiLinked=1`);
  } catch (error) {
    if (error instanceof AppHttpError) {
      const i18n = context.get("i18n");

      return renderFormError(context, {
        message: error.localize(i18n),
        status: error.status,
        title: i18n.t("LMS activity link not saved"),
      });
    }

    throw error;
  }
});

ltiRoutes.post("/grade-jobs/:jobId/retry", async (context) => {
  const actor = requireAuthenticated(context);
  const form = await context.req.raw.formData();
  const courseId = fieldValue(form.get("courseId"));

  try {
    await new GradePassbackService({
      sender: null,
      stores: storesForContext(context),
    }).retryJob(actor, context.req.param("jobId"));

    // Deliver the re-queued job right away instead of waiting for the cron.
    kickGradePassback(context);

    return redirect(`/courses/${courseId}?gradeSyncRetried=1`);
  } catch (error) {
    if (error instanceof AppHttpError) {
      const i18n = context.get("i18n");

      return renderFormError(context, {
        message: error.localize(i18n),
        status: error.status,
        title: i18n.t("Grade delivery not retried"),
      });
    }

    throw error;
  }
});

/**
 * The tool's public key set. LMS registration forms ask for this URL; the
 * key itself is only used from milestone 11 onward (Deep Linking and AGS
 * message signing), so an empty set is honest while no key is configured.
 */
ltiRoutes.get("/jwks", (context) => {
  const configured = context.env.LTI_TOOL_PRIVATE_KEY;

  if (configured === undefined || configured.trim().length === 0) {
    return context.json({ keys: [] });
  }

  let parsed: Record<string, unknown>;

  try {
    parsed = JSON.parse(configured) as Record<string, unknown>;
  } catch (_error) {
    console.error("lti_tool_key_invalid", {
      requestId: context.get("requestId"),
    });

    return context.json({ keys: [] });
  }

  const publicJwk = publicJwkFields(parsed);

  if (publicJwk === null) {
    console.error("lti_tool_key_invalid", {
      requestId: context.get("requestId"),
    });

    return context.json({ keys: [] });
  }

  return context.json({ keys: [publicJwk] });
});

/**
 * The secret must be a single asymmetric private JWK. Copying an allowlist of
 * public members (instead of stripping known private ones) fails closed: a
 * misconfigured secret — a whole JWKS, a symmetric key, a key type whose
 * private fields we did not anticipate — publishes nothing rather than
 * everything.
 */
const PUBLIC_JWK_MEMBERS = [
  "kty",
  "use",
  "alg",
  "kid",
  "n",
  "e",
  "crv",
  "x",
  "y",
] as const;

function publicJwkFields(
  jwk: Record<string, unknown>,
): Record<string, unknown> | null {
  const kty = jwk.kty;

  if (typeof kty !== "string" || kty === "oct") {
    return null;
  }

  const publicJwk: Record<string, unknown> = {};

  for (const member of PUBLIC_JWK_MEMBERS) {
    if (jwk[member] !== undefined) {
      publicJwk[member] = jwk[member];
    }
  }

  return publicJwk;
}
