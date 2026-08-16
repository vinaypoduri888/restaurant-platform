import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../shared/app-env.ts";
import { logger } from "../shared/logger.ts";

/**
 * Binds a request-scoped logger (carrying the request id) onto the context,
 * echoes the id back in the `X-Request-Id` response header, and records one
 * completion line per request.
 *
 * Handlers should use `c.get("logger")` so every line they emit is
 * automatically correlated to the request that produced it.
 */
export const requestLogger = createMiddleware<AppEnv>(async (c, next) => {
  const requestId = c.get("requestId");
  const requestLog = logger.child({ requestId });

  c.set("logger", requestLog);
  c.header("X-Request-Id", requestId);

  const startedAt = performance.now();

  requestLog.debug("request received", {
    method: c.req.method,
    path: c.req.path,
  });

  await next();

  const durationMs = Math.round(performance.now() - startedAt);
  const level = c.res.status >= 500 ? "error" : c.res.status >= 400 ? "warn" : "info";

  requestLog[level]("request completed", {
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    durationMs,
  });
});
