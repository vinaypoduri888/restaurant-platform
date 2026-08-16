import { createMiddleware } from "hono/factory";
import { auth } from "../modules/auth/auth.config.ts";
import type { AppEnv } from "../shared/app-env.ts";
import { UnauthorizedError } from "../shared/errors.ts";

/**
 * Resolves the session if one exists and attaches it to the context, without
 * rejecting anonymous callers. Use on routes that are readable by anyone but
 * behave differently when signed in.
 */
export const attachSession = createMiddleware<AppEnv>(async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  c.set("session", session ?? null);
  await next();
});

/**
 * Rejects anonymous callers with 401.
 *
 * Downstream handlers can rely on `c.get("user")` being present — that is the
 * whole point of splitting this from `attachSession`, so a protected handler
 * never has to null-check identity.
 */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });

  if (!session) {
    throw new UnauthorizedError();
  }

  c.set("session", session);
  c.set("user", session.user);
  c.get("logger").debug("authenticated request", { userId: session.user.id });

  await next();
});
