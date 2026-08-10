import { Hono } from "hono";

import type { LtiPlatformKeyResolver } from "./application/lti";
import type { AppBindings, WorkerApp } from "./http";
import { actorMiddleware, csrfMiddleware } from "./middleware/auth";
import { errorHandler, notFoundHandler } from "./middleware/errors";
import {
  localeDetectorMiddleware,
  localeMiddleware,
} from "./middleware/locale";
import { requestIdMiddleware } from "./middleware/request-id";
import { securityHeadersMiddleware } from "./middleware/security-headers";
import { adminRoutes } from "./routes/admin";
import { adminLtiRoutes } from "./routes/admin-lti";
import { assignmentRoutes } from "./routes/assignments";
import { authRoutes } from "./routes/auth";
import { contentRoutes } from "./routes/content";
import { courseRoutes, enrollmentRoutes } from "./routes/courses";
import { gradebookRoutes } from "./routes/gradebook";
import { healthRoutes } from "./routes/health";
import { ltiRoutes } from "./routes/lti";
import { scriptRoutes } from "./routes/scripts";
import { styleRoutes } from "./routes/styles";
import { webRoutes } from "./routes/web";

export interface CreateAppOptions {
  readonly configure?: (app: WorkerApp) => void;
  /**
   * Test seam: verify LTI launch tokens against an injected key set instead
   * of fetching the platform's JWKS. Must be threaded here (not through
   * `configure`) because middleware registered after the route mounts would
   * never run for them.
   */
  readonly lti?: {
    readonly keyResolver?: LtiPlatformKeyResolver;
  };
}

export function createApp(options: CreateAppOptions = {}): WorkerApp {
  const app = new Hono<AppBindings>();
  const ltiKeyResolver = options.lti?.keyResolver;

  // First of everything, because it is the only middleware that has to apply to
  // responses the rest of the stack never sees. It reads nothing and does no
  // I/O — it writes a handful of constant headers onto whatever came back — so
  // putting it ahead of the asset routes below costs them nothing.
  app.use("*", securityHeadersMiddleware());

  // Before the rest of the middleware, and that position is the point. Hono runs
  // matched handlers in the order they were registered, so a route mounted here
  // answers and returns without any of the below ever running. The stylesheets
  // and scripts are the same bytes for every reader, so resolving a session
  // against the database to serve one is a query asked for nothing.
  // Anything mounted after this line does get the middleware; anything that
  // needs an actor, a locale, or CSRF must go below it.
  app.route("/", styleRoutes);
  app.route("/", scriptRoutes);

  app.use("*", requestIdMiddleware());
  // Locale resolves in two passes around authentication: the request's own
  // preference first — translator and all, so even a request rejected below
  // renders in a sensible language — then the signed-in user's stored choice
  // once the actor is known. Nothing between the two may assume the second has
  // run, and nothing after may assume it has not.
  app.use("*", localeDetectorMiddleware());
  app.use("*", actorMiddleware());
  app.use("*", localeMiddleware());
  app.use("*", csrfMiddleware());

  if (ltiKeyResolver !== undefined) {
    app.use("/lti/*", async (context, next) => {
      context.set("ltiKeyResolver", ltiKeyResolver);
      await next();
    });
  }

  app.onError(errorHandler);
  app.route("/", webRoutes);
  app.route("/health", healthRoutes);
  app.route("/auth", authRoutes);
  app.route("/lti", ltiRoutes);
  app.route("/admin/lti", adminLtiRoutes);
  app.route("/admin", adminRoutes);
  app.route("/content", contentRoutes);
  app.route("/courses", gradebookRoutes);
  app.route("/courses", assignmentRoutes);
  app.route("/courses", courseRoutes);
  app.route("/enrollments", enrollmentRoutes);

  options.configure?.(app);

  app.notFound(notFoundHandler);

  return app;
}
