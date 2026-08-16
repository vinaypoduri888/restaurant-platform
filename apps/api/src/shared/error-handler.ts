import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { Prisma } from "@repo/database";
import type { AppEnv } from "./app-env.ts";
import { AppError } from "./errors.ts";
import { logger as rootLogger } from "./logger.ts";

interface ErrorBody {
  success: false;
  error: {
    message: string;
    requestId?: string;
    issues?: unknown;
  };
}

function body(message: string, requestId?: string): ErrorBody {
  return { success: false, error: { message, ...(requestId ? { requestId } : {}) } };
}

/**
 * The single place an error becomes an HTTP response.
 *
 * Two rules hold everywhere:
 *  - Deliberate (`AppError`) failures keep their message; the caller needs it.
 *  - Everything else is logged in full server-side and reduced to a generic
 *    500 for the client. Stack traces, SQL, and Prisma internals never leave
 *    the process.
 */
export function registerErrorHandler(app: Hono<AppEnv>) {
  app.notFound((c) => {
    const requestId = c.get("requestId");
    return c.json(body(`Route ${c.req.method} ${c.req.path} not found`, requestId), 404);
  });

  app.onError((err, c) => {
    const requestId = c.get("requestId");
    const log = c.get("logger") ?? rootLogger;

    // Deliberate application errors: safe to surface.
    if (err instanceof AppError) {
      log.warn("request failed", {
        errorName: err.name,
        status: err.status,
        reason: err.message,
      });
      return c.json(body(err.message, requestId), err.status);
    }

    // Raised by Hono itself and by middleware such as body-limit.
    if (err instanceof HTTPException) {
      log.warn("request rejected", { status: err.status, reason: err.message });
      return c.json(body(err.message, requestId), err.status as ContentfulStatusCode);
    }

    // Defence in depth: the service layer checks uniqueness before writing, but
    // two concurrent requests can still race past that check to the database.
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2002") {
        log.warn("unique constraint violated", { prismaCode: err.code });
        return c.json(body("A record with this value already exists", requestId), 409);
      }
      if (err.code === "P2025") {
        log.warn("record not found", { prismaCode: err.code });
        return c.json(body("Record not found", requestId), 404);
      }
      // Any other Prisma error is an internal fault — fall through to 500.
    }

    log.error("unhandled error", { err });
    return c.json(body("Internal server error", requestId), 500);
  });
}
