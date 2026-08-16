import type { RequestIdVariables } from "hono/request-id";
import type { AuthSession } from "../modules/auth/auth.config.ts";
import type { Logger } from "./logger.ts";

/**
 * Typed Hono environment shared by the app and every module's router.
 *
 * `requestId` comes from Hono's built-in request-id middleware; `logger` is a
 * request-scoped child logger already bound to that id; `session`/`user` are
 * populated by the auth middleware.
 *
 * `user` is non-optional in the type but only actually set by `requireAuth`,
 * so it must only be read on routes guarded by that middleware.
 */
export type AppEnv = {
  Variables: RequestIdVariables & {
    logger: Logger;
    session: AuthSession | null;
    user: AuthSession["user"];
  };
};
