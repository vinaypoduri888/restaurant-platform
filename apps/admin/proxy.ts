import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic redirect for signed-out visitors.
 *
 * In Next 16 this file is `proxy.ts`, not `middleware.ts` — the feature was
 * renamed; the behaviour is the same.
 *
 * **This is not the authorization check.** Next's own documentation is explicit
 * that proxy "should not be used as a full session management or authorization
 * solution", and this only looks at whether a session cookie is *present* — it
 * does not verify it, because that would put a network round trip in front of
 * every request including static assets.
 *
 * The real check lives in the authenticated layout, which asks the API who the
 * caller is and redirects if the answer is nobody. This exists purely so a
 * signed-out visitor lands on the sign-in page immediately instead of watching
 * a dashboard shell render and then disappear.
 *
 * A forged cookie therefore gets past this and is rejected a moment later by
 * the layout — which is the correct division of labour, not a gap.
 */
export function proxy(request: NextRequest) {
  const hasSessionCookie = request.cookies
    .getAll()
    .some((cookie) => cookie.name.includes("better-auth") && cookie.value.length > 0);

  if (hasSessionCookie) {
    return NextResponse.next();
  }

  const signIn = new URL("/login", request.url);

  // Remember where they were headed so sign-in can return them there. Only the
  // path and query are carried, never a full URL from the request — accepting
  // one of those is how open-redirect bugs happen.
  const target = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  if (target !== "/") {
    signIn.searchParams.set("next", target);
  }

  return NextResponse.redirect(signIn);
}

export const config = {
  /*
   * Everything except the signed-out pages, Next's internals, and static
   * files. Without the exclusions this would redirect the sign-in page to
   * itself.
   *
   * ─── Why every recovery route has to be listed ────────────────────────────
   *
   * These pages are reached *by definition* without a session: someone who has
   * forgotten their password cannot sign in first, and a verification link is
   * followed before an account can be used at all. Omitting one does not
   * degrade it — it makes the flow impossible, because the visitor is bounced
   * to a sign-in they cannot complete. Caught in live verification, where
   * `/reset-password/<token>` answered 307 instead of rendering.
   *
   * `invitations` is deliberately NOT excluded: accepting one requires an
   * account, so bouncing an anonymous invitee to sign-in is correct — and the
   * redirect carries the token in `?next=`, which is what returns them here.
   */
  matcher: [
    "/((?!login|register|forgot-password|reset-password|verify-email|_next/static|_next/image|favicon.ico).*)",
  ],
};
