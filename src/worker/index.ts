import { createApp } from "./app";
import type { Env } from "./env";
import { createD1Stores } from "./infrastructure/database/d1";
import { runGradePassback } from "./passback";

const app = createApp();

export default {
  fetch: app.fetch,
  // Sweeps the grade-passback outbox: jobs the post-request kick could not
  // deliver (LMS outage, dead worker) are retried here on their backoff
  // schedule.
  async scheduled(controller, env, _executionContext) {
    if (env.DB === undefined) {
      return;
    }

    await runGradePassback(
      env,
      createD1Stores(env.DB),
      `cron-${controller.scheduledTime}`,
    );
  },
} satisfies ExportedHandler<Env>;
