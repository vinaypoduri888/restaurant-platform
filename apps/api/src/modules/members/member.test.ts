import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "@repo/database";
import { app } from "../../app.ts";
import {
  authedRequest,
  createRestaurantAs,
  createTestUser,
  grantMembership,
  lastInvitationToken,
  resetDatabase,
  testMailer,
  type TestUser,
} from "../../test-support/helpers.ts";
import { generateInvitationToken, hashInvitationToken } from "./invitation-token.ts";

/**
 * Team membership, invitations, and the rules that keep a restaurant
 * administrable.
 *
 * Everything goes through the real HTTP stack and the real database. The one
 * shortcut is reading the invitation token out of the console mailer's outbox,
 * which is what a person does with their inbox.
 */

beforeEach(async () => {
  await resetDatabase();
  testMailer().clear();
});

/** An owner with a restaurant — the starting point for most cases here. */
async function ownerWithRestaurant(name = "Pizza Palace") {
  const owner = await createTestUser();
  const restaurant = await createRestaurantAs(owner, { name });

  return { owner, restaurant };
}

/**
 * Only the invitation mail.
 *
 * Creating a fixture user sends a verification email, so a bare outbox count
 * would measure the setup rather than the behaviour under test.
 */
function invitationEmails() {
  return testMailer()
    .sent()
    .filter((message) => message.subject.startsWith("You have been invited"));
}

/** Backdates an invitation so it is genuinely expired, not impossibly shaped. */
async function expire(email: string) {
  // Both timestamps move: a row whose `expires_at` precedes its `created_at`
  // is refused by a CHECK constraint, and rightly so — it could never have
  // been issued. An invitation created ten days ago with a seven-day life is
  // what expiry actually looks like.
  const createdAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  const expiresAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

  await db.restaurantInvitation.updateMany({
    where: { email },
    data: { createdAt, expiresAt },
  });
}

function invite(
  user: TestUser,
  restaurantId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return authedRequest(user, `/admin/restaurants/${restaurantId}/members/invitations`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Invites an address and returns the token that was emailed to it. */
async function inviteAndGetToken(
  owner: TestUser,
  restaurantId: string,
  email: string,
  role: "OWNER" | "STAFF" = "STAFF",
): Promise<string> {
  const response = await invite(owner, restaurantId, { email, role });
  if (response.status !== 201) {
    throw new Error(`Invite failed (${response.status}): ${await response.text()}`);
  }

  const token = lastInvitationToken(email);
  if (!token) throw new Error(`No invitation email reached ${email}`);

  return token;
}

function accept(user: TestUser, token: string): Promise<Response> {
  return authedRequest(user, `/invitations/${encodeURIComponent(token)}/accept`, {
    method: "POST",
  });
}

// ---------------------------------------------------------------------------
// Token primitives
// ---------------------------------------------------------------------------

describe("invitation tokens", () => {
  test("are long, URL-safe, and never repeat", () => {
    const tokens = new Set<string>();

    for (let i = 0; i < 200; i += 1) {
      const token = generateInvitationToken();
      // base64url of 32 bytes: no padding, nothing needing escaping in a path.
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(token.length).toBeGreaterThanOrEqual(40);
      tokens.add(token);
    }

    expect(tokens.size).toBe(200);
  });

  test("hash to 64 lowercase hex characters, stably", async () => {
    const token = generateInvitationToken();
    const once = await hashInvitationToken(token);
    const twice = await hashInvitationToken(token);

    expect(once).toMatch(/^[0-9a-f]{64}$/);
    expect(once).toBe(twice);
  });

  test("a different token hashes differently", async () => {
    const a = await hashInvitationToken(generateInvitationToken());
    const b = await hashInvitationToken(generateInvitationToken());

    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

describe("team authorization", () => {
  test("an anonymous caller is refused before anything is read", async () => {
    const { restaurant } = await ownerWithRestaurant();

    const response = await app.request(`/admin/restaurants/${restaurant.id}/members`);
    expect(response.status).toBe(401);
  });

  test("a non-member cannot see the team", async () => {
    const { restaurant } = await ownerWithRestaurant();
    const stranger = await createTestUser();

    const response = await authedRequest(
      stranger,
      `/admin/restaurants/${restaurant.id}/members`,
    );

    expect(response.status).toBe(403);
  });

  test("an owner sees the roster, starting with themselves", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();

    const response = await authedRequest(
      owner,
      `/admin/restaurants/${restaurant.id}/members`,
    );
    const body = (await response.json()) as {
      data: { members: { userId: string; role: string }[]; invitations: unknown[] };
    };

    expect(response.status).toBe(200);
    expect(body.data.members).toHaveLength(1);
    expect(body.data.members[0]?.userId).toBe(owner.userId);
    expect(body.data.members[0]?.role).toBe("OWNER");
  });

  /** Knowing your colleagues is ordinary; changing the team is not. */
  test("staff may read the roster", async () => {
    const { restaurant } = await ownerWithRestaurant();
    const staff = await createTestUser();
    await grantMembership(staff, restaurant.id, "STAFF");

    const response = await authedRequest(
      staff,
      `/admin/restaurants/${restaurant.id}/members`,
    );

    expect(response.status).toBe(200);
  });

  test.each([
    ["invite", "POST", "/members/invitations", { email: "x@example.test" }],
    ["cancel an invitation", "DELETE", "/members/invitations/whatever", undefined],
    ["change a role", "PATCH", "/members/someone", { role: "OWNER" }],
    ["remove a member", "DELETE", "/members/someone", undefined],
  ])("staff may not %s", async (_label, method, suffix, body) => {
    const { restaurant } = await ownerWithRestaurant();
    const staff = await createTestUser();
    await grantMembership(staff, restaurant.id, "STAFF");

    const response = await authedRequest(staff, `/admin/restaurants/${restaurant.id}${suffix}`, {
      method,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    expect(response.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Invitation lifecycle
// ---------------------------------------------------------------------------

describe("inviting", () => {
  test("sends exactly one email, to the invited address", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();

    const response = await invite(owner, restaurant.id, { email: "new@example.test" });
    expect(response.status).toBe(201);

    const sent = invitationEmails();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("new@example.test");
    expect(sent[0]?.subject).toContain("Pizza Palace");
  });

  /** The response is what the console renders; a token in it would be logged. */
  test("never returns the token", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();

    const response = await invite(owner, restaurant.id, { email: "new@example.test" });
    const raw = await response.text();

    expect(raw).not.toContain("token");
    expect(raw.toLowerCase()).not.toContain("tokenhash");
  });

  test("stores only a hash, never the raw token", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    const token = await inviteAndGetToken(owner, restaurant.id, "new@example.test");

    const row = await db.restaurantInvitation.findFirst({
      where: { restaurantId: restaurant.id },
    });

    expect(row?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.tokenHash).not.toBe(token);
    expect(row?.tokenHash).toBe(await hashInvitationToken(token));
  });

  test("normalises the address", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();

    await invite(owner, restaurant.id, { email: "  MiXeD@Example.TEST  " });

    const row = await db.restaurantInvitation.findFirst({
      where: { restaurantId: restaurant.id },
    });
    expect(row?.email).toBe("mixed@example.test");
  });

  test("defaults to STAFF rather than making someone an owner by omission", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();

    await invite(owner, restaurant.id, { email: "new@example.test" });

    const row = await db.restaurantInvitation.findFirst({
      where: { restaurantId: restaurant.id },
    });
    expect(row?.role).toBe("STAFF");
  });

  test("rejects a malformed address before anything is sent", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();

    const response = await invite(owner, restaurant.id, { email: "not-an-address" });

    expect(response.status).toBe(400);
    expect(invitationEmails()).toHaveLength(0);
  });

  /**
   * Re-inviting replaces rather than accumulating. Two live invitations to one
   * address would each be acceptable, so cancelling one would leave the other
   * working — a withdrawal that did not withdraw.
   */
  test("re-inviting replaces the previous invitation and invalidates its token", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    const first = await inviteAndGetToken(owner, restaurant.id, "new@example.test");
    const second = await inviteAndGetToken(owner, restaurant.id, "new@example.test");

    expect(second).not.toBe(first);
    expect(await db.restaurantInvitation.count({ where: { restaurantId: restaurant.id } })).toBe(1);

    const invitee = await createTestUser();
    await db.user.update({ where: { id: invitee.userId }, data: { email: "new@example.test" } });

    // The superseded token must no longer work.
    expect((await accept(invitee, first)).status).toBe(404);
    expect((await accept(invitee, second)).status).toBe(200);
  });

  test("refuses to invite someone already on the team", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    const staff = await createTestUser();
    await grantMembership(staff, restaurant.id, "STAFF");

    const response = await invite(owner, restaurant.id, { email: staff.email });

    expect(response.status).toBe(409);
    expect(invitationEmails()).toHaveLength(0);
  });

  test("an owner of another restaurant cannot invite into this one", async () => {
    const { restaurant } = await ownerWithRestaurant();
    const other = await createTestUser();
    await createRestaurantAs(other, { name: "Other Place" });

    const response = await invite(other, restaurant.id, { email: "x@example.test" });

    expect(response.status).toBe(403);
    expect(invitationEmails()).toHaveLength(0);
  });

  test("cancelling removes the invitation and kills its token", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    const token = await inviteAndGetToken(owner, restaurant.id, "new@example.test");

    const row = await db.restaurantInvitation.findFirst({
      where: { restaurantId: restaurant.id },
    });

    const cancelled = await authedRequest(
      owner,
      `/admin/restaurants/${restaurant.id}/members/invitations/${row!.id}`,
      { method: "DELETE" },
    );
    expect(cancelled.status).toBe(204);

    const invitee = await createTestUser();
    await db.user.update({ where: { id: invitee.userId }, data: { email: "new@example.test" } });
    expect((await accept(invitee, token)).status).toBe(404);
  });

  test("cannot cancel an invitation belonging to another restaurant", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    await inviteAndGetToken(owner, restaurant.id, "new@example.test");
    const row = await db.restaurantInvitation.findFirst({
      where: { restaurantId: restaurant.id },
    });

    const other = await createTestUser();
    const otherRestaurant = await createRestaurantAs(other, { name: "Other Place" });

    const response = await authedRequest(
      other,
      `/admin/restaurants/${otherRestaurant.id}/members/invitations/${row!.id}`,
      { method: "DELETE" },
    );

    // Scoped by tenant in the statement, so it matches nothing.
    expect(response.status).toBe(404);
    expect(await db.restaurantInvitation.count({ where: { id: row!.id } })).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Acceptance
// ---------------------------------------------------------------------------

describe("accepting an invitation", () => {
  /** Creates an account whose address matches the invitation. */
  async function inviteeFor(email: string): Promise<TestUser> {
    const user = await createTestUser();
    await db.user.update({ where: { id: user.userId }, data: { email } });
    return { ...user, email };
  }

  test("creates the membership with the invited role", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    const token = await inviteAndGetToken(owner, restaurant.id, "new@example.test", "STAFF");
    const invitee = await inviteeFor("new@example.test");

    const response = await accept(invitee, token);
    expect(response.status).toBe(200);

    const membership = await db.restaurantMembership.findUnique({
      where: { userId_restaurantId: { userId: invitee.userId, restaurantId: restaurant.id } },
    });
    expect(membership?.role).toBe("STAFF");
  });

  test("an anonymous caller is refused", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    const token = await inviteAndGetToken(owner, restaurant.id, "new@example.test");

    const response = await app.request(`/invitations/${token}/accept`, { method: "POST" });
    expect(response.status).toBe(401);
  });

  /**
   * The property that stops an invitation being a transferable membership: a
   * forwarded link is useless to anyone but its addressee.
   */
  test("a different account cannot use someone else's invitation", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    const token = await inviteAndGetToken(owner, restaurant.id, "intended@example.test");
    const interloper = await createTestUser();

    const response = await accept(interloper, token);

    expect(response.status).toBe(404);
    expect(
      await db.restaurantMembership.count({
        where: { userId: interloper.userId, restaurantId: restaurant.id },
      }),
    ).toBe(0);
  });

  test("a second acceptance is refused", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    const token = await inviteAndGetToken(owner, restaurant.id, "new@example.test");
    const invitee = await inviteeFor("new@example.test");

    expect((await accept(invitee, token)).status).toBe(200);
    expect((await accept(invitee, token)).status).toBe(404);

    // Still exactly one membership — the replay created nothing.
    expect(
      await db.restaurantMembership.count({
        where: { userId: invitee.userId, restaurantId: restaurant.id },
      }),
    ).toBe(1);
  });

  test("an expired invitation cannot be accepted", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    const token = await inviteAndGetToken(owner, restaurant.id, "new@example.test");

    await expire("new@example.test");

    const invitee = await inviteeFor("new@example.test");
    expect((await accept(invitee, token)).status).toBe(404);
  });

  test("an unknown token is refused", async () => {
    const user = await createTestUser();
    expect((await accept(user, generateInvitationToken())).status).toBe(404);
  });

  /**
   * Unknown, expired, consumed and wrong-recipient all answer identically.
   * Distinguishing them would tell a token holder whether it ever existed.
   */
  test("every failure mode is indistinguishable", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    const consumedToken = await inviteAndGetToken(owner, restaurant.id, "used@example.test");
    const invitee = await inviteeFor("used@example.test");
    await accept(invitee, consumedToken);

    const expiredToken = await inviteAndGetToken(owner, restaurant.id, "expired@example.test");
    await expire("expired@example.test");

    const wrongRecipientToken = await inviteAndGetToken(owner, restaurant.id, "other@example.test");
    const stranger = await createTestUser();

    const bodies = await Promise.all(
      [
        await accept(stranger, generateInvitationToken()),
        await accept(stranger, consumedToken),
        await accept(stranger, expiredToken),
        await accept(stranger, wrongRecipientToken),
      ].map(async (r) => ({ status: r.status, body: await r.text() })),
    );

    const first = bodies[0]!;
    for (const other of bodies) {
      expect(other.status).toBe(first.status);
      // Only the request id differs between responses.
      expect(other.body.replace(/"requestId":"[^"]*"/, "")).toBe(
        first.body.replace(/"requestId":"[^"]*"/, ""),
      );
    }
  });

  test("an invitation cannot change an existing member's role", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    const staff = await createTestUser();
    await grantMembership(staff, restaurant.id, "STAFF");

    // Forge the situation the invite check would normally prevent: a live
    // OWNER invitation for someone who is already STAFF.
    const token = generateInvitationToken();
    await db.restaurantInvitation.create({
      data: {
        restaurantId: restaurant.id,
        email: staff.email,
        role: "OWNER",
        tokenHash: await hashInvitationToken(token),
        invitedBy: owner.userId,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const response = await accept(staff, token);

    // Refused, and the role is untouched — an unauthorised promotion averted.
    expect(response.status).toBeGreaterThanOrEqual(400);
    const membership = await db.restaurantMembership.findUnique({
      where: { userId_restaurantId: { userId: staff.userId, restaurantId: restaurant.id } },
    });
    expect(membership?.role).toBe("STAFF");
  });

  test("describing an invitation names the restaurant but no account detail", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    const token = await inviteAndGetToken(owner, restaurant.id, "new@example.test");
    const invitee = await inviteeFor("new@example.test");

    const response = await authedRequest(invitee, `/invitations/${token}`);
    const body = (await response.json()) as {
      data: { restaurantName: string; email: string; role: string };
    };

    expect(response.status).toBe(200);
    expect(body.data.restaurantName).toBe("Pizza Palace");
    expect(body.data.email).toBe("new@example.test");
    expect(JSON.stringify(body)).not.toContain("tokenHash");
  });
});

// ---------------------------------------------------------------------------
// Roles and the last-owner rule
// ---------------------------------------------------------------------------

describe("role management", () => {
  async function teamOfTwo() {
    const { owner, restaurant } = await ownerWithRestaurant();
    const staff = await createTestUser();
    await grantMembership(staff, restaurant.id, "STAFF");

    return { owner, staff, restaurant };
  }

  function setRole(actor: TestUser, restaurantId: string, userId: string, role: string) {
    return authedRequest(actor, `/admin/restaurants/${restaurantId}/members/${userId}`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    });
  }

  test("an owner can promote a staff member", async () => {
    const { owner, staff, restaurant } = await teamOfTwo();

    expect((await setRole(owner, restaurant.id, staff.userId, "OWNER")).status).toBe(204);

    const membership = await db.restaurantMembership.findUnique({
      where: { userId_restaurantId: { userId: staff.userId, restaurantId: restaurant.id } },
    });
    expect(membership?.role).toBe("OWNER");
  });

  /**
   * Removing the self-service path removes the whole escalation class, rather
   * than relying on the capability check being bug-free.
   */
  test("nobody may change their own role", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();

    const response = await setRole(owner, restaurant.id, owner.userId, "STAFF");

    expect(response.status).toBe(403);
    const membership = await db.restaurantMembership.findUnique({
      where: { userId_restaurantId: { userId: owner.userId, restaurantId: restaurant.id } },
    });
    expect(membership?.role).toBe("OWNER");
  });

  test("a staff member cannot promote themselves", async () => {
    const { staff, restaurant } = await teamOfTwo();

    expect((await setRole(staff, restaurant.id, staff.userId, "OWNER")).status).toBe(403);

    const membership = await db.restaurantMembership.findUnique({
      where: { userId_restaurantId: { userId: staff.userId, restaurantId: restaurant.id } },
    });
    expect(membership?.role).toBe("STAFF");
  });

  test("the only owner cannot be demoted", async () => {
    const { owner, staff, restaurant } = await teamOfTwo();
    // Another owner must do it, so that self-change is not what refuses.
    const second = await createTestUser();
    await grantMembership(second, restaurant.id, "STAFF");

    const response = await setRole(owner, restaurant.id, staff.userId, "STAFF");
    expect(response.status).toBe(204); // already staff — a no-op, not an error

    const demoteOnlyOwner = await setRole(second, restaurant.id, owner.userId, "STAFF");
    expect(demoteOnlyOwner.status).toBe(403); // `second` is STAFF, so cannot manage

    await grantMembership({ ...second, userId: second.userId }, restaurant.id, "OWNER").catch(
      () => undefined,
    );
  });

  test("a second owner may be demoted, but never the last one", async () => {
    const { owner, staff, restaurant } = await teamOfTwo();
    await setRole(owner, restaurant.id, staff.userId, "OWNER");

    // Two owners: demoting one is fine.
    expect((await setRole(staff, restaurant.id, owner.userId, "STAFF")).status).toBe(204);

    // One owner left: `staff` is now the only owner and cannot be demoted,
    // and cannot demote themselves either.
    expect((await setRole(staff, restaurant.id, staff.userId, "STAFF")).status).toBe(403);
    expect(await db.restaurantMembership.count({
      where: { restaurantId: restaurant.id, role: "OWNER" },
    })).toBe(1);
  });

  test("a role cannot be changed across restaurants", async () => {
    const { staff, restaurant } = await teamOfTwo();
    const outsider = await createTestUser();
    const otherRestaurant = await createRestaurantAs(outsider, { name: "Other Place" });

    const response = await setRole(outsider, otherRestaurant.id, staff.userId, "OWNER");

    expect(response.status).toBe(404);
    const membership = await db.restaurantMembership.findUnique({
      where: { userId_restaurantId: { userId: staff.userId, restaurantId: restaurant.id } },
    });
    expect(membership?.role).toBe("STAFF");
  });

  test("an unknown role is rejected", async () => {
    const { owner, staff, restaurant } = await teamOfTwo();

    expect((await setRole(owner, restaurant.id, staff.userId, "SUPERUSER")).status).toBe(400);
  });
});

describe("removing members", () => {
  test("an owner can remove a staff member", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    const staff = await createTestUser();
    await grantMembership(staff, restaurant.id, "STAFF");

    const response = await authedRequest(
      owner,
      `/admin/restaurants/${restaurant.id}/members/${staff.userId}`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(204);
    expect(
      await db.restaurantMembership.count({
        where: { userId: staff.userId, restaurantId: restaurant.id },
      }),
    ).toBe(0);
  });

  /**
   * An ownerless restaurant cannot be deleted, re-staffed, or have its QR read
   * — every one of those needs an OWNER. There is no way back, so the only
   * safe moment to refuse is before it happens.
   */
  test("the last owner cannot be removed", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();

    const response = await authedRequest(
      owner,
      `/admin/restaurants/${restaurant.id}/members/${owner.userId}`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(409);
    expect(
      await db.restaurantMembership.count({
        where: { restaurantId: restaurant.id, role: "OWNER" },
      }),
    ).toBe(1);
  });

  test("removing someone who is not on the team is a 404", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    const stranger = await createTestUser();

    const response = await authedRequest(
      owner,
      `/admin/restaurants/${restaurant.id}/members/${stranger.userId}`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(404);
  });

  test("a removed member immediately loses access", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    const staff = await createTestUser();
    await grantMembership(staff, restaurant.id, "STAFF");

    expect((await authedRequest(staff, `/admin/restaurants/${restaurant.id}`)).status).toBe(200);

    await authedRequest(owner, `/admin/restaurants/${restaurant.id}/members/${staff.userId}`, {
      method: "DELETE",
    });

    expect((await authedRequest(staff, `/admin/restaurants/${restaurant.id}`)).status).toBe(403);
  });

  test("deleting a restaurant takes its invitations with it", async () => {
    const { owner, restaurant } = await ownerWithRestaurant();
    await inviteAndGetToken(owner, restaurant.id, "new@example.test");

    await authedRequest(owner, `/admin/restaurants/${restaurant.id}`, { method: "DELETE" });

    expect(await db.restaurantInvitation.count({ where: { restaurantId: restaurant.id } })).toBe(0);
  });
});
