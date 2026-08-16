import { Hono } from "hono";
import type { AppEnv } from "../../shared/app-env.ts";
import { healthService } from "./health.service.ts";

export const healthRoutes = new Hono<AppEnv>()
  .get("/health", (c) => {
    healthService.isAlive();
    return c.json({ status: "ok" as const }, 200);
  })
  .get("/ready", async (c) => {
    const result = await healthService.checkReadiness();

    if (!result.ready) {
      c.get("logger").error("readiness check failed", { checks: result.checks });
      return c.json({ status: "unavailable" as const, checks: result.checks }, 503);
    }

    return c.json({ status: "ok" as const, checks: result.checks }, 200);
  });
