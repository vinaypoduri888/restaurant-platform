"use server";

import { revalidatePath } from "next/cache";
import { replaceOperatingHoursSchema } from "@repo/validation/operating-hours";
import { replaceOperatingHours } from "../api/restaurants";
import { buildWeekFromFormData, toHoursFieldErrors } from "../forms/hours-payload";
import { formError, formSuccess, type FormState } from "../forms/state";
import { toFormState } from "./error-mapping";

/**
 * Saving a week of operating hours.
 *
 * The form posts `HH:MM` strings because that is what `<input type="time">`
 * produces; the API stores minutes past local midnight. The conversion happens
 * on the server and is then validated with the **shared**
 * `@repo/validation` schema — the same object the API parses with — so the
 * console and the API cannot disagree about what a valid week is.
 *
 * The restaurant id is a bound argument, never read from the submitted form: a
 * hidden input can be edited in devtools, a bound argument cannot. The API
 * re-authorizes the membership regardless, so this is defence in depth rather
 * than the boundary.
 */
export async function replaceHoursAction(
  restaurantId: string,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { days, fieldErrors } = buildWeekFromFormData(formData);

  // Unparseable times are reported before the schema runs, so the message says
  // "enter a time" rather than the schema's "expected number, received null".
  if (Object.keys(fieldErrors).length > 0) {
    return formError("Please check the highlighted times.", fieldErrors);
  }

  const parsed = replaceOperatingHoursSchema.safeParse({ days });

  if (!parsed.success) {
    return formError(
      "Please check the highlighted times.",
      toHoursFieldErrors(parsed.error.issues),
    );
  }

  try {
    await replaceOperatingHours(restaurantId, parsed.data.days);
  } catch (error) {
    return toFormState(error);
  }

  // The overview page renders the editor from this data; without this an owner
  // would submit a change and be shown the old times, which reads as a failure.
  revalidatePath(`/restaurants/${restaurantId}`);

  return formSuccess("Opening hours saved.");
}
