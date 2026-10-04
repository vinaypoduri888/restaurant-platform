import { describe, expect, test } from "bun:test";
import { config } from "../../proxy";

/**
 * Which paths `proxy.ts` guards.
 *
 * ─── Why this is tested at all ──────────────────────────────────────────────
 *
 * The matcher is one regular expression in a config object, and getting it
 * wrong does not fail a build, a type-check or any component test — it fails
 * silently, in production, for people who are signed out.
 *
 * It did: `/reset-password/<token>` answered 307 to the sign-in page, which
 * made password recovery impossible to complete. Someone who has forgotten
 * their password cannot sign in first, so bouncing them to sign-in is not a
 * degraded experience, it is a dead end. Found by requesting the page over real
 * HTTP; pinned here so it cannot come back.
 */

/** Rebuilds the matcher the way Next applies it. */
function guards(pathname: string): boolean {
  const patterns = config.matcher;

  return patterns.some((pattern) => new RegExp(`^${pattern}$`).test(pathname));
}

describe("proxy matcher", () => {
  /**
   * Every one of these is reached *by definition* without a session.
   */
  test.each([
    ["/login"],
    ["/register"],
    ["/forgot-password"],
    ["/reset-password"],
    ["/reset-password/some-token-value"],
    ["/verify-email"],
  ])("%s is reachable signed out", (pathname) => {
    expect(guards(pathname)).toBe(false);
  });

  test.each([
    ["/"],
    ["/restaurants"],
    ["/restaurants/r1"],
    ["/restaurants/r1/team"],
    ["/restaurants/r1/qr"],
    ["/restaurants/r1/menu/items"],
  ])("%s is guarded", (pathname) => {
    expect(guards(pathname)).toBe(true);
  });

  /**
   * Accepting an invitation creates a membership, which needs an account — so
   * bouncing an anonymous invitee to sign-in is correct here. The redirect
   * carries the token in `?next=`, which is what brings them back.
   */
  test("invitation acceptance is guarded, so the token round-trips through sign-in", () => {
    expect(guards("/invitations/some-token")).toBe(true);
  });

  test("Next's own assets are left alone", () => {
    expect(guards("/_next/static/chunk.js")).toBe(false);
    expect(guards("/favicon.ico")).toBe(false);
  });
});
