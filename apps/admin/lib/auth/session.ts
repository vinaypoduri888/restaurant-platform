import { cache } from "react";
import { redirect } from "next/navigation";
import { sessionCookieHeader } from "../api/client";

/**
 * Session reading.
 *
 * The session is resolved by asking the API, never by decoding the cookie here.
 * The cookie is a signed opaque token; only the API can say whether it is still
 * valid, whether it was revoked, and who it belongs to. Trusting its contents
 * locally would make sign-out and expiry advisory rather than enforced.
 */

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3001";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

export interface Session {
  user: SessionUser;
}

/**
 * The current session, or `null` when signed out.
 *
 * Wrapped in React `cache` so a layout, a page, and any component in the same
 * render share one call instead of each making their own.
 *
 * A failure to reach the API returns `null` rather than throwing. Treating
 * "cannot verify" as "not signed in" is the fail-safe direction: the worst
 * outcome is an unnecessary sign-in, whereas the alternative would show
 * authenticated UI on unverified identity.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const cookieHeader = await sessionCookieHeader();
  if (!cookieHeader) return null;

  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/get-session`, {
      headers: { Accept: "application/json", Cookie: cookieHeader },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });

    if (!response.ok) return null;

    const body = (await response.json()) as { user?: SessionUser } | null;
    return body?.user ? { user: body.user } : null;
  } catch (cause) {
    console.error("[admin-auth] session lookup failed", { cause });
    return null;
  }
});

/**
 * The authoritative gate for authenticated pages.
 *
 * `proxy.ts` also redirects anonymous visitors, but that check is optimistic —
 * it only looks for the presence of a cookie, because Next's docs are explicit
 * that proxy is not a session-management layer. This is the check that actually
 * verifies the session with the API, and it runs inside the layout so no
 * authenticated page can render without it.
 */
export async function requireSession(): Promise<Session> {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  return session;
}
