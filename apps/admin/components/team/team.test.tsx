import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { canManageTeam, isLastOwner, type TeamMember } from "@/lib/api/members";
import { safeNextPath } from "@/lib/auth/next-path";
import { InvitationRow } from "./invitation-row";
import { MemberRow } from "./member-row";

afterEach(cleanup);

function member(overrides: Partial<TeamMember> = {}): TeamMember {
  return {
    userId: "u1",
    role: "STAFF",
    createdAt: "2026-10-01T00:00:00.000Z",
    user: { id: "u1", name: "Sam Taylor", email: "sam@example.test" },
    ...overrides,
  };
}

function renderMember(overrides: {
  member?: Partial<TeamMember>;
  canManage?: boolean;
  isSelf?: boolean;
  isLastOwner?: boolean;
} = {}) {
  return render(
    <MemberRow
      restaurantId="r1"
      member={member(overrides.member)}
      canManage={overrides.canManage ?? true}
      isSelf={overrides.isSelf ?? false}
      isLastOwner={overrides.isLastOwner ?? false}
    />,
  );
}

describe("role helpers", () => {
  test("only an owner may manage the team", () => {
    expect(canManageTeam("OWNER")).toBe(true);
    expect(canManageTeam("STAFF")).toBe(false);
  });

  test("the sole owner is identified, and is not once there are two", () => {
    const owner = member({ userId: "o1", role: "OWNER" });
    const staff = member({ userId: "s1", role: "STAFF" });
    const second = member({ userId: "o2", role: "OWNER" });

    expect(isLastOwner([owner, staff], "o1")).toBe(true);
    expect(isLastOwner([owner, staff], "s1")).toBe(false);
    expect(isLastOwner([owner, second], "o1")).toBe(false);
  });

  test("an empty team has no last owner", () => {
    expect(isLastOwner([], "o1")).toBe(false);
  });
});

describe("MemberRow", () => {
  test("shows who someone is and what they are", () => {
    renderMember({ member: { role: "OWNER" } });

    expect(screen.getByText("Sam Taylor")).toBeDefined();
    expect(screen.getByText("sam@example.test")).toBeDefined();
    expect(screen.getByText("Owner")).toBeDefined();
  });

  test("marks the signed-in user so nobody edits the wrong row", () => {
    renderMember({ isSelf: true });
    expect(screen.getByText("(you)")).toBeDefined();
  });

  test("an owner is offered promotion and removal of a staff member", () => {
    renderMember({ canManage: true });

    expect(screen.getByRole("button", { name: "Make owner" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Remove" })).toBeDefined();
  });

  /** Staff hold `member:read` only — a roster, with nothing to press. */
  test("staff see no controls at all", () => {
    renderMember({ canManage: false });

    expect(screen.queryByRole("button", { name: /make/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
  });

  /**
   * Removing the self-service path removes the escalation class, rather than
   * relying on the capability check being bug-free.
   */
  test("nobody is offered a change to their own role", () => {
    renderMember({ isSelf: true, canManage: true });

    expect(screen.queryByRole("button", { name: /make/i })).toBeNull();
    expect(screen.getByText(/cannot change your own role/i)).toBeDefined();
  });

  test("the last owner can be neither demoted nor removed, and is told why", () => {
    renderMember({ member: { role: "OWNER" }, isLastOwner: true, canManage: true });

    expect(screen.queryByRole("button", { name: /make staff/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(screen.getByText(/only owner cannot be removed/i)).toBeDefined();
  });

  /** Leaving is legitimate; being the last owner is what stops it. */
  test("an owner who is not the last may still be removed", () => {
    renderMember({ member: { role: "OWNER" }, isLastOwner: false, canManage: true });

    expect(screen.getByRole("button", { name: "Remove" })).toBeDefined();
  });
});

describe("InvitationRow", () => {
  const invitation = {
    id: "i1",
    email: "new@example.test",
    role: "STAFF" as const,
    expiresAt: "2026-12-01T00:00:00.000Z",
    acceptedAt: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    hasExpired: false,
  };

  test("shows the address and the offered role", () => {
    render(
      <InvitationRow restaurantId="r1" invitation={invitation} canManage hasExpired={false} />,
    );

    expect(screen.getByText("new@example.test")).toBeDefined();
    expect(screen.getByText("Staff")).toBeDefined();
  });

  /** The token is a bearer credential; the API cannot even return it. */
  test("never renders a token", () => {
    const { container } = render(
      <InvitationRow restaurantId="r1" invitation={invitation} canManage hasExpired={false} />,
    );

    expect(container.innerHTML.toLowerCase()).not.toContain("token");
  });

  test("an owner can withdraw it", () => {
    render(
      <InvitationRow restaurantId="r1" invitation={invitation} canManage hasExpired={false} />,
    );

    expect(screen.getByRole("button", { name: "Withdraw" })).toBeDefined();
  });

  test("staff are offered no withdrawal", () => {
    render(
      <InvitationRow
        restaurantId="r1"
        invitation={invitation}
        canManage={false}
        hasExpired={false}
      />,
    );

    expect(screen.queryByRole("button", { name: "Withdraw" })).toBeNull();
  });

  /** Said in words, not implied by a date the reader must compare to today. */
  test("an expired invitation says so, and says what to do", () => {
    render(
      <InvitationRow restaurantId="r1" invitation={invitation} canManage hasExpired />,
    );

    expect(screen.getByText("Expired")).toBeDefined();
    expect(screen.getByText(/invite again/i)).toBeDefined();
  });
});

/**
 * The redirect target carried through sign-in.
 *
 * This matters for invitations: a signed-out invitee is bounced to `/login`
 * with `?next=/invitations/<token>`, and must come back. An unchecked value
 * here would be an open redirect on a page where the victim has just proved
 * they trust the site.
 */
describe("safeNextPath", () => {
  test("keeps a same-site path", () => {
    expect(safeNextPath("/invitations/abc")).toBe("/invitations/abc");
    expect(safeNextPath("/restaurants/r1/team")).toBe("/restaurants/r1/team");
  });

  test("refuses an absolute URL", () => {
    expect(safeNextPath("https://evil.test/phish")).toBe("/");
    expect(safeNextPath("http://evil.test")).toBe("/");
  });

  /** `//evil.test` is protocol-relative: a browser treats it as another site. */
  test("refuses a protocol-relative URL", () => {
    expect(safeNextPath("//evil.test/phish")).toBe("/");
  });

  /** Some browsers normalise backslashes to slashes when resolving. */
  test("refuses a backslash smuggle", () => {
    expect(safeNextPath("/\\evil.test")).toBe("/");
    expect(safeNextPath("\\\\evil.test")).toBe("/");
  });

  test("falls back for an absent or relative value", () => {
    expect(safeNextPath(undefined)).toBe("/");
    expect(safeNextPath("")).toBe("/");
    expect(safeNextPath("restaurants/r1")).toBe("/");
  });
});
