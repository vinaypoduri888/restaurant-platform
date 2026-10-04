import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

/**
 * `next/headers`, `next/navigation` and `next/cache` only exist inside a
 * request, so they are stubbed. The cookie store is a real object here, because
 * what these tests are actually checking is *what gets written to it* — the
 * adoption of the API's session cookie is the highest-risk part of the sign-in
 * flow, and a mistake there either signs everyone out or leaves the token
 * readable by scripts.
 */
interface StoredCookie {
  name: string;
  value: string;
  httpOnly?: boolean;
  sameSite?: string;
  secure?: boolean;
  path?: string;
  maxAge?: number;
}

let stored: StoredCookie[] = [];
let deleted: string[] = [];
let redirectedTo: string | null = null;

const cookieStore = {
  getAll: () => stored,
  set: (cookie: StoredCookie) => stored.push(cookie),
  delete: (name: string) => deleted.push(name),
};

mock.module("next/headers", () => ({ cookies: async () => cookieStore }));
mock.module("next/cache", () => ({ revalidatePath: () => {} }));
mock.module("next/navigation", () => ({
  redirect: (to: string) => {
    redirectedTo = to;
    // The real `redirect` signals by throwing; mimicking that is what proves
    // the actions do not accidentally catch it and report a false failure.
    throw new Error("NEXT_REDIRECT");
  },
}));

const { signInAction, signUpAction, signOutAction } = await import("./actions");

const originalFetch = globalThis.fetch;

beforeEach(() => {
  stored = [];
  deleted = [];
  redirectedTo = null;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function formOf(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

function mockAuthResponse(init: {
  status?: number;
  setCookie?: string[];
  jsonBody?: unknown;
}) {
  const headers = new Headers();
  for (const cookie of init.setCookie ?? []) headers.append("set-cookie", cookie);

  globalThis.fetch = (async () =>
    ({
      ok: (init.status ?? 200) < 400,
      status: init.status ?? 200,
      headers,
      json: async () => init.jsonBody ?? {},
    }) as unknown as Response) as unknown as typeof fetch;
}

const validCredentials = { email: "owner@example.test", password: "a-long-enough-password" };

describe("signInAction", () => {
  test("rejects a malformed email before spending a round trip", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}");
    }) as unknown as typeof fetch;

    const state = await signInAction(undefined, { status: "idle" }, formOf({ email: "nope", password: "x" }));

    expect(state.status).toBe("error");
    expect(state.fieldErrors?.email).toBeDefined();
    expect(called).toBe(false);
  });

  test("requires a password", async () => {
    const state = await signInAction(
      undefined,
      { status: "idle" },
      formOf({ email: "owner@example.test", password: "" }),
    );

    expect(state.fieldErrors?.password).toBeDefined();
  });

  /**
   * The heart of the server-side auth flow: the API's session is re-issued on
   * this app's own origin, with flags declared here rather than copied.
   */
  test("adopts the session cookie with safe flags", async () => {
    mockAuthResponse({
      setCookie: [
        "better-auth.session_token=abc%2Fdef; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax",
      ],
    });

    await expect(signInAction(undefined, { status: "idle" }, formOf(validCredentials))).rejects.toThrow(
      "NEXT_REDIRECT",
    );

    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      name: "better-auth.session_token",
      // Kept URL-encoded exactly as issued: the value is signed, and re-encoding
      // it would change the bytes the API verifies.
      value: "abc%2Fdef",
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 604800,
    });
  });

  /**
   * Better Auth renames its cookie to `__Secure-…` once secure cookies are on.
   * A hard-coded name would work in development and sign everyone out in
   * production, so the name is read from the response.
   */
  test("adopts the production cookie name as issued", async () => {
    mockAuthResponse({
      setCookie: [
        "__Secure-better-auth.session_token=xyz; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax",
      ],
    });

    await expect(signInAction(undefined, { status: "idle" }, formOf(validCredentials))).rejects.toThrow(
      "NEXT_REDIRECT",
    );

    expect(stored[0]?.name).toBe("__Secure-better-auth.session_token");
  });

  test("ignores unrelated cookies the API happens to set", async () => {
    mockAuthResponse({
      setCookie: [
        "analytics_id=123; Path=/",
        "better-auth.session_token=abc; Max-Age=604800; Path=/",
      ],
    });

    await expect(signInAction(undefined, { status: "idle" }, formOf(validCredentials))).rejects.toThrow(
      "NEXT_REDIRECT",
    );

    expect(stored.map((cookie) => cookie.name)).toEqual(["better-auth.session_token"]);
  });

  test("redirects into the dashboard on success", async () => {
    mockAuthResponse({ setCookie: ["better-auth.session_token=abc; Max-Age=604800; Path=/"] });

    await expect(signInAction(undefined, { status: "idle" }, formOf(validCredentials))).rejects.toThrow(
      "NEXT_REDIRECT",
    );

    expect(redirectedTo).toBe("/");
  });

  /** Better Auth's messages are written for end users, so they are shown as-is. */
  test("surfaces bad credentials without storing a session", async () => {
    mockAuthResponse({
      status: 401,
      jsonBody: { message: "Invalid email or password", code: "INVALID_EMAIL_OR_PASSWORD" },
    });

    const state = await signInAction(undefined, { status: "idle" }, formOf(validCredentials));

    expect(state.status).toBe("error");
    expect(state.message).toBe("Invalid email or password");
    expect(stored).toHaveLength(0);
  });

  test("reports rate limiting in its own words", async () => {
    mockAuthResponse({ status: 429 });

    const state = await signInAction(undefined, { status: "idle" }, formOf(validCredentials));

    expect(state.message).toMatch(/too many attempts/i);
  });

  /** A 5xx message could carry internals, so it is replaced rather than shown. */
  test("does not surface a server error message", async () => {
    mockAuthResponse({
      status: 500,
      jsonBody: { message: "ECONNREFUSED postgres://user:pw@10.0.0.4:5432" },
    });

    const state = await signInAction(undefined, { status: "idle" }, formOf(validCredentials));

    expect(state.message).not.toContain("postgres");
    expect(state.message).not.toContain("10.0.0.4");
  });

  test("a network failure is reported without detail", async () => {
    globalThis.fetch = (async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:3001");
    }) as unknown as typeof fetch;

    const state = await signInAction(undefined, { status: "idle" }, formOf(validCredentials));

    expect(state.status).toBe("error");
    expect(state.message).not.toContain("ECONNREFUSED");
  });

  /**
   * A "success" with no cookie would leave the user apparently signed in but
   * with no session — every later request would 401.
   */
  test("treats a missing session cookie as a failure", async () => {
    mockAuthResponse({ setCookie: [] });

    const state = await signInAction(undefined, { status: "idle" }, formOf(validCredentials));

    expect(state.status).toBe("error");
    expect(redirectedTo).toBeNull();
  });
});

describe("signUpAction", () => {
  test("enforces the API's 12-character minimum before submitting", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}");
    }) as unknown as typeof fetch;

    const state = await signUpAction(
      { status: "idle" },
      formOf({ name: "Owner", email: "owner@example.test", password: "short" }),
    );

    expect(state.fieldErrors?.password).toMatch(/12 characters/);
    expect(called).toBe(false);
  });

  test("requires a name", async () => {
    const state = await signUpAction(
      { status: "idle" },
      formOf({ name: "", ...validCredentials }),
    );

    expect(state.fieldErrors?.name).toBeDefined();
  });

  test("signs the new account in and redirects", async () => {
    mockAuthResponse({ setCookie: ["better-auth.session_token=abc; Max-Age=604800; Path=/"] });

    await expect(
      signUpAction({ status: "idle" }, formOf({ name: "Owner", ...validCredentials })),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(stored[0]?.name).toBe("better-auth.session_token");
    expect(redirectedTo).toBe("/");
  });

  test("surfaces a duplicate-account message", async () => {
    mockAuthResponse({
      status: 422,
      jsonBody: { message: "User already exists. Use another email.", code: "USER_ALREADY_EXISTS" },
    });

    const state = await signUpAction(
      { status: "idle" },
      formOf({ name: "Owner", ...validCredentials }),
    );

    expect(state.message).toMatch(/already exists/i);
  });
});

describe("signOutAction", () => {
  /**
   * Order matters. Clearing only the local cookie would leave a live session in
   * the database, so anyone holding a copy of the token would still be signed
   * in.
   */
  test("ends the session on the server, then clears the local cookie", async () => {
    stored = [{ name: "better-auth.session_token", value: "abc" }];

    let calledPath = "";
    globalThis.fetch = (async (url: string) => {
      calledPath = url;
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({}) } as unknown as Response;
    }) as unknown as typeof fetch;

    await expect(signOutAction()).rejects.toThrow("NEXT_REDIRECT");

    expect(calledPath).toContain("/api/auth/sign-out");
    expect(deleted).toContain("better-auth.session_token");
    expect(redirectedTo).toBe("/login");
  });

  /**
   * A user who clicked "sign out" must not be left looking at a signed-in page
   * because the API was unreachable.
   */
  test("clears the local cookie even when the API call fails", async () => {
    stored = [{ name: "better-auth.session_token", value: "abc" }];
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    await expect(signOutAction()).rejects.toThrow("NEXT_REDIRECT");

    expect(deleted).toContain("better-auth.session_token");
    expect(redirectedTo).toBe("/login");
  });
});
