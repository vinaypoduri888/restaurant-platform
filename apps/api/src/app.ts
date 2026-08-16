import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { config } from "./config.ts";
import { requestLogger } from "./middleware/request-logger.ts";
import {
  bodyLimitMiddleware,
  corsMiddleware,
  rateLimit,
  secureHeadersMiddleware,
} from "./middleware/security.ts";
import { auth } from "./modules/auth/auth.config.ts";
import { healthRoutes } from "./modules/health/health.routes.ts";
import {
  adminRestaurantRoutes,
  publicRestaurantRoutes,
} from "./modules/restaurants/restaurant.routes.ts";
import { docsRoutes } from "./openapi/openapi.routes.ts";
import type { AppEnv } from "./shared/app-env.ts";
import { registerErrorHandler } from "./shared/error-handler.ts";

/**
 * Builds the application without starting a server.
 *
 * Keeping construction separate from listening lets tests drive the app
 * through `app.request(...)` in-process — no port binding, no teardown races.
 * `index.ts` is the only place that opens a socket.
 */
export function createApp() {
  const app = new Hono<AppEnv>();

  // Order matters. requestId runs first so every later middleware — including
  // the logger and the error handler — can correlate to a single request.
  app.use("*", requestId());
  app.use("*", requestLogger);
  app.use("*", secureHeadersMiddleware);
  app.use("*", corsMiddleware);
  app.use("*", bodyLimitMiddleware);

  // Sign-in and sign-up are the endpoints worth brute-forcing, so they get a
  // tighter budget than ordinary API traffic. Applied only here, not globally.
  // The budget is configurable so the test suite can raise it; the middleware
  // itself is covered directly in security.test.ts.
  app.use("/api/auth/*", rateLimit(config.auth.rateLimit));

  // Better Auth owns everything under /api/auth (sign-up, sign-in, sign-out,
  // session). It consumes the raw Request and returns a standard Response.
  app.all("/api/auth/*", (c) => auth.handler(c.req.raw));

  app.get("/", (c) => c.json({ message: "Restaurant Platform API 🚀" }));

  app.route("/", healthRoutes);
  app.route("/", docsRoutes);
  app.route("/restaurants", publicRestaurantRoutes);
  app.route("/admin/restaurants", adminRestaurantRoutes);

  registerErrorHandler(app);

  return app;
}

export const app = createApp();
