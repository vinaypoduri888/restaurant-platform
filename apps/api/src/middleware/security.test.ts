import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { app } from "../app.ts";
import type { AppEnv } from "../shared/app-env.ts";
import { registerErrorHandler } from "../shared/error-handler.ts";
import { rateLimit } from "./security.ts";

/**
 * The application raises its auth rate limit under NODE_ENV=test so the suite
 * can create users freely. These tests therefore exercise the middleware
 * directly with a deliberately tiny budget, so the behaviour stays covered.
 */
describe("rate limiting", () => {
  function buildApp(max: number, trustedProxies: readonly string[] = []) {
    const testApp = new Hono<AppEnv>();
    testApp.use("*", rateLimit({ windowMs: 60_000, max, trustedProxies }));
    testApp.get("/limited", (c) => c.json({ ok: true }));
    registerErrorHandler(testApp);
    return testApp;
  }

  test("allows requests up to the limit then responds 429", async () => {
    const limited = buildApp(2);

    expect((await limited.request("/limited")).status).toBe(200);
    expect((await limited.request("/limited")).status).toBe(200);

    const blocked = await limited.request("/limited");
    expect(blocked.status).toBe(429);
    expect(await blocked.text()).toContain("Too many requests");
  });

  /**
   * The audit's HIGH finding, as an end-to-end regression: with a limit of 2,
   * 25 requests each carrying a different forged `X-Forwarded-For` previously
   * all succeeded. Untrusted forwarding headers must now be ignored outright.
   */
  test("rotating an untrusted X-Forwarded-For cannot bypass the limit", async () => {
    const limited = buildApp(2);

    const statuses: number[] = [];
    for (let index = 0; index < 25; index += 1) {
      const response = await limited.request("/limited", {
        headers: { "x-forwarded-for": `10.0.0.${index}` },
      });
      statuses.push(response.status);
    }

    expect(statuses.filter((status) => status === 200)).toHaveLength(2);
    expect(statuses.filter((status) => status === 429)).toHaveLength(23);
  });

  test("X-Real-IP is likewise not trusted for identity", async () => {
    const limited = buildApp(2);

    const statuses: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      const response = await limited.request("/limited", {
        headers: { "x-real-ip": `198.51.100.${index}` },
      });
      statuses.push(response.status);
    }

    expect(statuses.filter((status) => status === 200)).toHaveLength(2);
  });

  // NOTE: the trusted-proxy path (where X-Forwarded-For *is* honoured, giving
  // distinct clients independent budgets) is covered in
  // client-identity.test.ts. It cannot be exercised at this level because
  // in-process requests carry no socket, so no peer address exists to trust.
});

describe("security headers", () => {
  test("sets standard hardening headers", async () => {
    const response = await app.request("/health");

    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("CORS", () => {
  test("permits a configured origin", async () => {
    const response = await app.request("/health", {
      headers: { Origin: "http://localhost:3000" },
    });

    expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
  });

  test("does not reflect an unknown origin", async () => {
    const response = await app.request("/health", {
      headers: { Origin: "http://evil.example.com" },
    });

    // The absence of the header is what stops the browser sharing the response.
    expect(response.headers.get("access-control-allow-origin")).not.toBe(
      "http://evil.example.com",
    );
  });
});
