import { Hono } from "hono";

import type { AppBindings } from "../http";

export const healthRoutes = new Hono<AppBindings>();

healthRoutes.get("/", (context) => {
  return context.json({ status: "ok" });
});
