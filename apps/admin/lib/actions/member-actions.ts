"use server";

import { revalidatePath } from "next/cache";
import { inviteMemberSchema, restaurantRoleSchema } from "@repo/validation/member";
import {
  acceptInvitation,
  cancelInvitation,
  inviteMember,
  removeMember,
  updateMemberRole,
} from "../api/members";
import { fieldErrorsFromIssues, formError, formSuccess, textField } from "../forms/state";
import type { FormState } from "../forms/state";
import { toFormState } from "./error-mapping";

/**
 * Team mutations.
 *
 * `restaurantId` is a **bound argument** on every action rather than a form
 * field: a hidden input is editable by whoever controls the page, and binding
 * keeps the tenant out of the submitted body entirely. The API would refuse a
 * mismatch anyway — it takes the tenant from the authorized URL — but the
 * smaller attack surface costs nothing.
 */

export async function inviteMemberAction(
  restaurantId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  /*
   * Validated here with the same schema the API enforces, so an obvious
   * mistake is caught without a round trip. This is convenience, not a
   * control: the API re-validates and is the authority.
   */
  const parsed = inviteMemberSchema.safeParse({
    email: textField(formData.get("email")),
    role: textField(formData.get("role")) || undefined,
  });

  if (!parsed.success) {
    return formError(
      "Check the details below.",
      fieldErrorsFromIssues(parsed.error.issues),
    );
  }

  try {
    await inviteMember(restaurantId, parsed.data);
  } catch (error) {
    return toFormState(error);
  }

  revalidatePath(`/restaurants/${restaurantId}/team`);

  /*
   * Deliberately says only that it was sent. "An account already exists for
   * this address" or "they will need to register" would answer, to anyone who
   * can invite, whether an address is registered — the oracle the invitation
   * design exists to avoid.
   */
  return formSuccess(`Invitation sent to ${parsed.data.email}.`);
}

export async function cancelInvitationAction(
  restaurantId: string,
  invitationId: string,
  _previous: FormState,
  _formData: FormData,
): Promise<FormState> {
  try {
    await cancelInvitation(restaurantId, invitationId);
  } catch (error) {
    return toFormState(error);
  }

  revalidatePath(`/restaurants/${restaurantId}/team`);

  return formSuccess("Invitation withdrawn. Its link no longer works.");
}

export async function updateMemberRoleAction(
  restaurantId: string,
  userId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = restaurantRoleSchema.safeParse(textField(formData.get("role")));

  if (!parsed.success) {
    return formError("That is not a role.");
  }

  try {
    await updateMemberRole(restaurantId, userId, parsed.data);
  } catch (error) {
    return toFormState(error);
  }

  revalidatePath(`/restaurants/${restaurantId}/team`);

  return formSuccess("Role updated.");
}

export async function removeMemberAction(
  restaurantId: string,
  userId: string,
  _previous: FormState,
  _formData: FormData,
): Promise<FormState> {
  try {
    await removeMember(restaurantId, userId);
  } catch (error) {
    return toFormState(error);
  }

  revalidatePath(`/restaurants/${restaurantId}/team`);

  return formSuccess("Removed from the team.");
}

/**
 * Accepts an invitation on behalf of the signed-in account.
 *
 * The token is bound rather than submitted, so it never appears in a form the
 * page renders — one fewer place for a bearer credential to be copied out of.
 */
export async function acceptInvitationAction(
  token: string,
  _previous: FormState,
  _formData: FormData,
): Promise<FormState> {
  try {
    const accepted = await acceptInvitation(token);

    // The new membership changes what the dashboard lists.
    revalidatePath("/");

    return formSuccess(`You have joined ${accepted.restaurantName}.`);
  } catch (error) {
    return toFormState(error);
  }
}
