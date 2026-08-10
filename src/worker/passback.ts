import type { Context } from "hono";

import {
  type GradePassbackRunSummary,
  GradePassbackService,
} from "./application/grade-passback";
import type { AppStores } from "./application/stores";
import type { Env } from "./env";
import type { AppBindings } from "./http";
import { AgsClient } from "./infrastructure/lti/ags-client";
import { loadLtiToolKey } from "./infrastructure/lti/tool-key";
import { storesForContext } from "./stores";

const IDLE_SUMMARY: GradePassbackRunSummary = {
  claimed: 0,
  sent: 0,
  retried: 0,
  failed: 0,
  superseded: 0,
  deferred: 0,
};

/** Wire a passback run from the environment: tool key → AGS client → service. */
export async function runGradePassback(
  env: Env,
  stores: AppStores,
  requestId: string,
): Promise<GradePassbackRunSummary> {
  // No key configured is the normal state of a non-LTI deployment — the
  // cron ticks anyway, and must not spend queries or log noise on it.
  if (env.LTI_TOOL_PRIVATE_KEY === undefined) {
    return IDLE_SUMMARY;
  }

  const toolKey = await loadLtiToolKey(env.LTI_TOOL_PRIVATE_KEY);

  // A key that is set but will not load is an operator error worth its own
  // message — the sender-null path below would misreport it as unconfigured
  // while jobs silently sat pending.
  if (toolKey === null) {
    console.error("lti_tool_key_invalid", { requestId });
  }

  const sender = toolKey === null ? null : new AgsClient({ toolKey });
  const service = new GradePassbackService({ requestId, sender, stores });

  return service.processDueJobs();
}

/**
 * Best-effort delivery right after a request that may have queued grade
 * jobs, so the common case lands in the LMS within seconds. The cron sweep
 * is the guarantee; this only shortens the happy path, so any failure here
 * is logged and forgotten.
 */
export function kickGradePassback(context: Context<AppBindings>): void {
  if (context.env.LTI_TOOL_PRIVATE_KEY === undefined) {
    return;
  }

  const requestId = context.get("requestId") ?? "";

  try {
    // Both of these can throw, and both mean the same thing here: no storage
    // bound (`storesForContext`), or no execution context to defer into
    // (tests, direct `app.request`). Asking is cheaper than enumerating the
    // ways a host might not offer them — a self-hosted instance, for one,
    // binds no `DB` at all and used to fail this check on that alone.
    const stores = storesForContext(context);

    context.executionCtx.waitUntil(
      runGradePassback(context.env, stores, requestId).catch(
        (error: unknown) => {
          console.error("lti_grade_passback_kick_failed", {
            error: error instanceof Error ? error.message : String(error),
            requestId,
          });
        },
      ),
    );
  } catch (_error) {
    // The sweep delivers instead; this path only ever shortened the wait.
  }
}
