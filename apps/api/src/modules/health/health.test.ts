import { describe, expect, test } from "bun:test";
import { app } from "../../app.ts";

describe("health endpoints", () => {
  test("GET /health reports the process is alive", async () => {
    const response = await app.request("/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("GET /ready confirms the database is reachable", async () => {
    const response = await app.request("/ready");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", checks: { database: "ok" } });
  });

  test("every response carries a request id header", async () => {
    const response = await app.request("/health");

    expect(response.headers.get("x-request-id")).toBeTruthy();
  });

  test("distinct requests get distinct request ids", async () => {
    const [first, second] = await Promise.all([app.request("/health"), app.request("/health")]);

    expect(first.headers.get("x-request-id")).not.toBe(second.headers.get("x-request-id"));
  });
});

describe("error handling", () => {
  test("unknown routes return a 404 in the standard envelope", async () => {
    const response = await app.request("/does-not-exist");
    const body = (await response.json()) as { success: boolean; error: { requestId?: string } };

    expect(response.status).toBe(404);
    expect(body.success).toBe(false);
    // The request id is what ties a client-side failure to a server log line.
    expect(body.error.requestId).toBeTruthy();
  });
});
