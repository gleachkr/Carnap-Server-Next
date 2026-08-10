import { type Context, Hono } from "hono";
import { getCookie } from "hono/cookie";

import {
  type AuthenticatedActor,
  AuthService,
  SESSION_COOKIE_NAME,
} from "../application/auth";
import { requireAuthenticated } from "../application/authorization";
import { AppHttpError, badRequest } from "../application/errors";
import { type AppBindings, clientIpAddress } from "../http";
import { deferred } from "../i18n/deferred";
import { storesForContext } from "../stores";
import { clearSessionCookies, setSessionCookies } from "./session-cookies";

interface StartLoginBody {
  readonly email?: unknown;
  readonly name?: unknown;
}

interface ConfirmLoginBody {
  readonly loginToken?: unknown;
}

async function readJsonObject(
  context: Context<AppBindings>,
): Promise<Record<string, unknown>> {
  try {
    const body = await context.req.json();

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw badRequest("invalid_json", "A JSON object is required.");
    }

    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof AppHttpError) {
      throw error;
    }

    throw badRequest("invalid_json", "A JSON object is required.");
  }
}

function authService(context: Context<AppBindings>): AuthService {
  return new AuthService({ stores: storesForContext(context) });
}

function publicUser(actor: AuthenticatedActor) {
  return {
    id: actor.user.id,
    email: actor.user.email,
    name: actor.user.name,
  };
}

export const authRoutes = new Hono<AppBindings>();

authRoutes.post("/login/start", async (context) => {
  const body = (await readJsonObject(context)) as StartLoginBody;

  if (typeof body.email !== "string") {
    throw badRequest(
      "invalid_email",
      deferred.i18n.t("A valid email address is required."),
    );
  }

  if (
    body.name !== undefined &&
    body.name !== null &&
    typeof body.name !== "string"
  ) {
    throw badRequest("invalid_name", "Name must be a string.");
  }

  const started = await authService(context).startNativeLogin({
    email: body.email,
    ipAddress: clientIpAddress(context),
    name: typeof body.name === "string" ? body.name : null,
  });
  const includeLoginToken = context.env.CARNAP_ENV === "local";

  return context.json(
    {
      login: {
        email: started.email,
        expiresAt: started.expiresAt,
        loginToken: includeLoginToken ? started.loginToken : undefined,
      },
    },
    202,
  );
});

authRoutes.post("/login/confirm", async (context) => {
  const body = (await readJsonObject(context)) as ConfirmLoginBody;

  if (typeof body.loginToken !== "string") {
    throw badRequest(
      "invalid_login_token",
      deferred.i18n.t("A login token is required."),
    );
  }

  const confirmed = await authService(context).confirmNativeLogin(
    body.loginToken,
  );

  setSessionCookies(context, confirmed.sessionToken, confirmed.csrfToken);

  return context.json({
    actor: publicUser(confirmed.actor),
    csrfToken: confirmed.csrfToken,
  });
});

authRoutes.get("/me", (context) => {
  const actor = requireAuthenticated(context);

  return context.json({ actor: publicUser(actor) });
});

authRoutes.post("/logout", async (context) => {
  requireAuthenticated(context);

  const sessionToken = getCookie(context, SESSION_COOKIE_NAME);

  if (sessionToken !== undefined) {
    await authService(context).logout(sessionToken);
  }

  clearSessionCookies(context);

  return context.body(null, 204);
});
