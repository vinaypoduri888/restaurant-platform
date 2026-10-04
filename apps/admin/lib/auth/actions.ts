"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  forgotPasswordSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
} from "@repo/validation/auth";
import { sessionCookieHeader } from "../api/client";
import { safeNextPath } from "./next-path";
import {
  fieldErrorsFromIssues,
  formError,
  formSuccess,
  textField,
  type FormState,
} from "../forms/state";

/**
 * Authentication, performed server-side.
 *
 * ─── Why the browser never talks to the API ─────────────────────────────────
 *
 * The obvious alternative is to post credentials from the browser straight to
 * the API and let it set the cookie. That works in development — cookies ignore
 * ports, so one set by `localhost:3001` is sent to `localhost:3002` — but in
 * production `api.example.com` will not send its cookie to
 * `admin.example.com` unless both are scoped to a shared parent domain. It
 * would also require publishing the API's URL to the browser and opening CORS
 * with credentials.
 *
 * Doing it here instead: the Server Action posts to the API, reads the
 * `Set-Cookie` it returns, and re-issues that session on the admin app's own
 * origin. The API's location stays server-side, no CORS is involved, and the
 * two can be deployed on unrelated domains.
 *
 * Verified before choosing this: the API accepts a server-to-server sign-in
 * with no `Origin` header (200 + `Set-Cookie`), while a request carrying an
 * untrusted browser `Origin` is still refused with 403. Better Auth's CSRF
 * protection is therefore intact, and Next's own Server Action origin check
 * covers the form post that reaches this file.
 */

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3001";

interface AuthFailure {
  message?: string;
  code?: string;
}

/**
 * Better Auth returns `{ message, code }` rather than the API's own envelope,
 * so these responses are read directly instead of through `apiRequest`.
 *
 * Its messages are written for end users ("Invalid email or password"), so they
 * are surfaced as-is. The one case that is overridden is a server error, whose
 * message is not something to show anybody.
 */
async function postAuth(
  path: string,
  body: unknown,
): Promise<{ ok: true; response: Response } | { ok: false; state: FormState }> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
  } catch (cause) {
    console.error("[admin-auth] request failed", { path, cause });
    return {
      ok: false,
      state: formError("We couldn't reach the service. Please try again."),
    };
  }

  if (response.ok) return { ok: true, response };

  if (response.status === 429) {
    return {
      ok: false,
      state: formError("Too many attempts. Please wait a moment and try again."),
    };
  }

  if (response.status >= 500) {
    console.error("[admin-auth] server error", { path, status: response.status });
    return { ok: false, state: formError("Something went wrong. Please try again.") };
  }

  const failure = (await response.json().catch(() => null)) as AuthFailure | null;
  return {
    ok: false,
    state: formError(failure?.message ?? "That didn't work. Please check your details."),
  };
}

/**
 * Copies the API's session cookie onto this app's own origin.
 *
 * The cookie's *name* is taken from the response rather than hard-coded,
 * because Better Auth renames it to `__Secure-better-auth.session_token` once
 * secure cookies are enabled — a hard-coded name would work in development and
 * silently sign everybody out in production.
 *
 * The flags are re-declared rather than copied: `httpOnly` keeps the token out
 * of reach of any script on the page, `sameSite: "lax"` blocks cross-site
 * submission while still allowing normal navigation, and `secure` tracks the
 * environment because browsers reject secure cookies over plain
 * `http://localhost`.
 */
async function adoptSessionCookie(response: Response): Promise<boolean> {
  const setCookies = readSetCookies(response);
  const store = await cookies();
  let adopted = false;

  for (const raw of setCookies) {
    const [pair = "", ...attributes] = raw.split(";");
    const separator = pair.indexOf("=");
    if (separator < 1) continue;

    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (!name.includes("better-auth")) continue;

    store.set({
      name,
      // Kept URL-encoded exactly as issued: the value is signed, and decoding
      // then re-encoding it risks changing the bytes the API will verify.
      value,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      // Mirror the API's own lifetime so the local cookie does not outlive the
      // session it points at, leaving a user "signed in" to a dead token.
      maxAge: readMaxAge(attributes),
    });
    adopted = true;
  }

  return adopted;
}

function readSetCookies(response: Response): string[] {
  // `getSetCookie` preserves multiple headers; `get` would join them into one
  // string that cannot be split reliably, because cookie dates contain commas.
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie();
  }
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

function readMaxAge(attributes: string[]): number | undefined {
  for (const attribute of attributes) {
    const [key = "", value = ""] = attribute.split("=");
    if (key.trim().toLowerCase() === "max-age") {
      const parsed = Number(value.trim());
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------


export async function signInAction(
  next: string | undefined,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = signInSchema.safeParse({
    email: textField(formData.get("email")),
    password: textField(formData.get("password")),
  });

  if (!parsed.success) {
    return formError(
      "Please check the highlighted fields.",
      fieldErrorsFromIssues(parsed.error.issues),
    );
  }

  const result = await postAuth("/api/auth/sign-in/email", parsed.data);
  if (!result.ok) return result.state;

  if (!(await adoptSessionCookie(result.response))) {
    console.error("[admin-auth] sign-in succeeded but returned no session cookie");
    return formError("Sign-in didn't complete. Please try again.");
  }

  // Outside the try/catch above on purpose: `redirect` works by throwing, and
  // catching it would turn a successful sign-in into an error message.
  redirect(safeNextPath(next));
}

export async function signUpAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = signUpSchema.safeParse({
    name: textField(formData.get("name")),
    email: textField(formData.get("email")),
    password: textField(formData.get("password")),
  });

  if (!parsed.success) {
    return formError(
      "Please check the highlighted fields.",
      fieldErrorsFromIssues(parsed.error.issues),
    );
  }

  const result = await postAuth("/api/auth/sign-up/email", parsed.data);
  if (!result.ok) return result.state;

  if (!(await adoptSessionCookie(result.response))) {
    console.error("[admin-auth] sign-up succeeded but returned no session cookie");
    return formError("Your account was created, but sign-in didn't complete. Please sign in.");
  }

  redirect("/");
}

/**
 * Ends the session on the server first, then locally.
 *
 * Order matters: clearing only the local cookie would leave a valid session
 * alive in the database, so anyone holding a copy of the token would still be
 * signed in. The local cookie is cleared even if the API call fails, because a
 * user who clicked "sign out" must not be left looking at a signed-in page.
 */
export async function signOutAction(): Promise<void> {
  const cookieHeader = await sessionCookieHeader();

  if (cookieHeader) {
    try {
      await fetch(`${API_BASE_URL}/api/auth/sign-out`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieHeader,
        },
        body: "{}",
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      });
    } catch (cause) {
      console.error("[admin-auth] sign-out request failed", { cause });
    }
  }

  const store = await cookies();
  for (const cookie of store.getAll()) {
    if (cookie.name.includes("better-auth")) {
      store.delete(cookie.name);
    }
  }

  redirect("/login");
}

/**
 * Asks for a password-reset email.
 *
 * ─── Why this always reports success ────────────────────────────────────────
 *
 * The API answers identically whether or not the address exists — it even
 * simulates the token work so the timing matches. Reporting anything
 * conditional here would undo that: "no account with that address" is exactly
 * the oracle the endpoint is built to withhold, and a form that leaked it would
 * make the backend's care pointless.
 *
 * So the message is the same either way, and it is phrased so it is not a lie
 * in either case.
 */
export async function requestPasswordResetAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = forgotPasswordSchema.safeParse({
    email: textField(formData.get("email")),
  });

  if (!parsed.success) {
    return formError(
      "Please check the highlighted fields.",
      fieldErrorsFromIssues(parsed.error.issues),
    );
  }

  const result = await postAuth("/api/auth/request-password-reset", {
    email: parsed.data.email,
    // Where the emailed link should land. The API builds the link itself from
    // its own configuration; this is sent for parity with Better Auth's shape.
    redirectTo: "/reset-password",
  });

  /*
   * A transport failure or a rate limit is still reported — those are about
   * this request, not about whether the account exists.
   */
  if (!result.ok) return result.state;

  return formSuccess(
    "If that address has an account, a reset link is on its way. It expires in one hour.",
  );
}

/**
 * Completes a reset with the token from the emailed link.
 *
 * On success the API revokes every existing session, so the user is signed out
 * everywhere including here — which is the point. They are sent to sign in
 * again with the new password rather than being silently re-authenticated.
 */
export async function resetPasswordAction(
  token: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = resetPasswordSchema.safeParse({
    password: textField(formData.get("password")),
    confirmPassword: textField(formData.get("confirmPassword")),
  });

  if (!parsed.success) {
    return formError(
      "Please check the highlighted fields.",
      fieldErrorsFromIssues(parsed.error.issues),
    );
  }

  const result = await postAuth("/api/auth/reset-password", {
    token,
    newPassword: parsed.data.password,
  });

  if (!result.ok) {
    /*
     * The common failure is an expired or already-used link, and Better Auth's
     * own message does not explain the fix. Saying what to do next matters more
     * than echoing the status.
     */
    return formError(
      "That link is no longer valid. Reset links expire after an hour and work once — request a new one.",
    );
  }

  redirect("/login?reset=1");
}

/** Sends another verification email to a signed-out address. */
export async function resendVerificationAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = forgotPasswordSchema.safeParse({
    email: textField(formData.get("email")),
  });

  if (!parsed.success) {
    return formError(
      "Please check the highlighted fields.",
      fieldErrorsFromIssues(parsed.error.issues),
    );
  }

  const result = await postAuth("/api/auth/send-verification-email", {
    email: parsed.data.email,
    callbackURL: "/verify-email",
  });

  if (!result.ok) return result.state;

  // Same reasoning as the reset form: no conditional wording.
  return formSuccess(
    "If that address needs confirming, a new link is on its way.",
  );
}
