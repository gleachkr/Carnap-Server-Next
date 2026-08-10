import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  driver: "d1-http",
  out: "src/worker/infrastructure/database/migrations",
  schema: "src/worker/infrastructure/database/schema.ts",
});
