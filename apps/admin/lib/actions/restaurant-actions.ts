"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createRestaurantSchema, updateRestaurantSchema } from "@repo/validation/restaurant";
import { ApiError } from "../api/client";
import { createRestaurant, updateRestaurant } from "../api/restaurants";
import {
  checkboxField,
  fieldErrorsFromIssues,
  formError,
  formSuccess,
  optionalField,
  textField,
  type FormState,
} from "../forms/state";
import { toFormState } from "./error-mapping";

/**
 * Restaurant mutations.
 *
 * Every action validates with the **shared** `@repo/validation` schemas — the
 * same objects the API parses with. That is what stops the console and the API
 * disagreeing about what "valid" means, and it is why no Zod schema is
 * redefined in this app.
 *
 * Validation runs on the server, inside the action, rather than in the browser.
 * The rules are identical either way, but this keeps Zod out of the client
 * bundle entirely — on a dashboard that is a fair trade, since the round trip
 * is fast and the API re-validates regardless.
 */

function readRestaurantFields(formData: FormData) {
  return {
    name: textField(formData.get("name")),
    description: optionalField(formData.get("description")),
    email: optionalField(formData.get("email")),
    phone: optionalField(formData.get("phone")),
    address: optionalField(formData.get("address")),
    city: optionalField(formData.get("city")),
    country: optionalField(formData.get("country")),
    currency: optionalField(formData.get("currency")),
    timeZone: optionalField(formData.get("timeZone")),
  };
}

export async function createRestaurantAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = createRestaurantSchema.safeParse(readRestaurantFields(formData));

  if (!parsed.success) {
    return formError(
      "Please check the highlighted fields.",
      fieldErrorsFromIssues(parsed.error.issues),
    );
  }

  let restaurantId: string;
  try {
    const restaurant = await createRestaurant(parsed.data);
    restaurantId = restaurant.id;
  } catch (error) {
    return toFormState(error);
  }

  revalidatePath("/");
  // Outside the try/catch: `redirect` signals by throwing, and catching it
  // would turn a successful create into an error message.
  redirect(`/restaurants/${restaurantId}`);
}

export async function updateRestaurantAction(
  restaurantId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = updateRestaurantSchema.safeParse({
    ...readRestaurantFields(formData),
    // An unchecked checkbox submits nothing at all, so its absence is a real
    // `false` rather than "not supplied".
    isActive: checkboxField(formData.get("isActive")),
  });

  if (!parsed.success) {
    return formError(
      "Please check the highlighted fields.",
      fieldErrorsFromIssues(parsed.error.issues),
    );
  }

  try {
    await updateRestaurant(restaurantId, parsed.data);
  } catch (error) {
    return toFormState(error);
  }

  // The overview page reads this record; without this the owner would submit a
  // change and be shown the old value, which reads as the save having failed.
  revalidatePath(`/restaurants/${restaurantId}`);
  revalidatePath("/");

  return formSuccess("Restaurant details saved.");
}

/** Re-exported so callers can narrow on it without importing the client. */
export type { ApiError };
