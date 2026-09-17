import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import { secureHeaders } from "hono/secure-headers";
import { config } from "../config.ts";
import type { AppEnv } from "../shared/app-env.ts";
import { TooManyRequestsError } from "../shared/errors.ts";
import { resolveClientIdentity } from "./client-identity.ts";

/**
 * The real TCP peer address, or undefined when it cannot be determined —
 * which is the case for in-process test requests that have no socket behind
 * them. Callers must treat undefined as "untrusted, unknown client".
 */
function getPeerAddress(c: Context<AppEnv>): string | undefined {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    return undefined;
  }
}

/**
 * CORS with an explicit origin allow-list from configuration.
 *
 * Never `*`: these endpoints will carry session cookies once authentication
 * lands, and a wildcard origin cannot be combined with credentialed requests.
 * Configure via the CORS_ORIGINS environment variable.
 */
export const corsMiddleware = cors({
  origin: config.corsOrigins,
  allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
  exposeHeaders: ["X-Request-Id"],
  credentials: true,
  maxAge: 86_400,
});

/**
 * Standard hardening response headers (nosniff, frame-deny, referrer policy,
 * and friends). This is a JSON API, so the browser-facing surface is small,
 * but these are free and prevent a whole class of mistakes.
 */
export const secureHeadersMiddleware = secureHeaders();

/** Media uploads are the only route allowed to exceed the JSON body limit. */
function isMediaUpload(path: string): boolean {
  return /^\/admin\/restaurants\/[^/]+\/media\/?$/.test(path);
}

function tooLarge(limitBytes: number) {
  return (c: Context<AppEnv>) => {
    c.get("logger")?.warn("request body too large", { limitBytes });
    return c.json(
      {
        success: false as const,
        error: { message: "Request body too large", requestId: c.get("requestId") },
      },
      413,
    );
  };
}

/**
 * Reject oversized bodies before they are parsed or buffered into memory.
 *
 * Two limits, not one. A 1 MB cap is right for JSON and far too small for a
 * banner image, but raising the global limit to suit uploads would weaken every
 * other endpoint — an attacker could then post a 5 MB JSON body to any route.
 * So the media upload path gets its own, larger allowance and everything else
 * keeps the strict default.
 */
export const bodyLimitMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const limit = isMediaUpload(c.req.path) ? config.media.maxBytes : config.bodyLimitBytes;

  return bodyLimit({ maxSize: limit, onError: tooLarge(limit) })(c, next);
});

interface RateLimitOptions {
  /** Rolling window length in milliseconds. */
  windowMs: number;
  /** Maximum requests permitted per client within the window. */
  max: number;
  /**
   * Proxies permitted to set `X-Forwarded-For`. Defaults to the configured
   * list; injectable so the behaviour can be tested both ways.
   */
  trustedProxies?: readonly string[];
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Minimal in-process fixed-window rate limiter.
 *
 * Client identity comes from the real TCP peer address. `X-Forwarded-For` is
 * consulted **only** when that peer is a configured trusted proxy — otherwise a
 * client could rotate the header and get an unlimited number of buckets. See
 * `client-identity.ts` for the resolution rules.
 *
 * Scope note (deliberate, documented limitation): counters live in this
 * process's memory, so with multiple API instances each enforces the limit
 * independently. That is adequate for protecting a single instance from
 * brute-force and accidental hammering, and it adds no infrastructure. When
 * the API is genuinely scaled horizontally this must move to a shared store
 * (Redis) — see PROJECT_ROADMAP.md Phase 10.
 *
 * It is applied narrowly (to authentication-style endpoints), not globally, so
 * normal API traffic is unaffected.
 */
export function rateLimit({ windowMs, max, trustedProxies }: RateLimitOptions) {
  const buckets = new Map<string, Bucket>();
  const proxies = trustedProxies ?? config.trustedProxies;

  return createMiddleware<AppEnv>(async (c, next) => {
    const key = resolveClientIdentity({
      peerAddress: getPeerAddress(c),
      forwardedFor: c.req.header("x-forwarded-for"),
      trustedProxies: proxies,
    });

    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
    } else if (bucket.count >= max) {
      throw new TooManyRequestsError();
    } else {
      bucket.count += 1;
    }

    // Opportunistic cleanup so the map cannot grow without bound.
    if (buckets.size > 10_000) {
      for (const [bucketKey, value] of buckets) {
        if (now >= value.resetAt) buckets.delete(bucketKey);
      }
    }

    await next();
  });
}
