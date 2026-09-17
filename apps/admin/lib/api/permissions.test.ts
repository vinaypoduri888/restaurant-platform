import { describe, expect, test } from "bun:test";
import { canDelete, type MembershipRole } from "./restaurants";

/**
 * `canDelete` mirrors the backend's capability table, where `restaurant:delete`
 * and `menu:delete` are OWNER-only.
 *
 * It exists so that mapping is written once rather than re-derived in every
 * component — the failure mode of duplicating it is that the two drift and the
 * UI starts offering actions the API refuses.
 *
 * It is **not** a security control. The API re-authorizes every write, so these
 * tests assert a presentation rule, not an enforcement one.
 */
describe("canDelete", () => {
  test("an owner may delete", () => {
    expect(canDelete("OWNER")).toBe(true);
  });

  test("a staff member may not", () => {
    expect(canDelete("STAFF")).toBe(false);
  });

  /**
   * Deny by default. If a role is ever added to the backend without this
   * function being updated, the safe outcome is hiding a control someone can
   * use — not offering one they cannot, which reads as a broken button.
   */
  test("an unrecognised role is treated as unable to delete", () => {
    expect(canDelete("MANAGER" as MembershipRole)).toBe(false);
  });
});
