/**
 * Copy for permission-dependent UI.
 *
 * The console now knows the caller's role: `GET /admin/restaurants/:id` returns
 * it alongside the record, read from the membership row that authorized the
 * request. `canDelete` in `./restaurants.ts` is the single place that maps a
 * role to what it may do.
 *
 * **None of this is a security control.** It decides which controls to render,
 * so a staff member is not offered a delete button that will always refuse.
 * The backend re-authorizes every write independently, and a client that
 * ignored or forged the role would gain nothing.
 *
 * The 403 message below is still needed. A role can be revoked between the page
 * rendering and the button being pressed, so a refusal remains possible even
 * when the UI was correct at render time.
 */

/** Shown if the API refuses a delete despite the UI having offered it. */
export const DELETE_FORBIDDEN_MESSAGE =
  "Only an owner can delete menu content. You can hide it instead — that takes it off the customer menu and can be undone.";

/** Shown alongside a delete control that the caller *can* use. */
export const DELETE_PERMISSION_HINT = "Deleting is permanent and cannot be undone.";

/** Shown in place of a delete control the caller cannot use. */
export const DELETE_UNAVAILABLE_HINT =
  "Only an owner can delete this. You can hide it instead, which takes it off the customer menu and can be undone.";
