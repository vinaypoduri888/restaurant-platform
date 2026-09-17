import { DAYS_OF_WEEK, type DayOfWeek } from "@repo/validation/operating-hours";
import { fromTimeInputValue } from "@repo/ui/lib/opening-hours";
import { checkboxField, textField } from "./state";

/**
 * Turns the hours form's submission into the payload the API expects.
 *
 * Kept out of the `"use server"` action file so it can be tested directly: this
 * is the one place where a person's `HH:MM` typing becomes the minute integers
 * that decide when a restaurant appears open, and it is worth exercising
 * without spinning up a request.
 */

export interface DayHoursPayload {
  dayOfWeek: DayOfWeek;
  isClosed: boolean;
  opensAt?: number | null;
  closesAt?: number | null;
}

export interface WeekPayload {
  days: DayHoursPayload[];
  /** Field name → message, for times the browser did not supply usably. */
  fieldErrors: Record<string, string>;
}

/**
 * Reads all seven days, whatever the form contains.
 *
 * Driven by `DAYS_OF_WEEK` rather than by iterating the submitted keys: the API
 * requires a complete week, so a day missing from the form must still produce
 * an entry rather than silently shrinking the payload to six.
 */
export function buildWeekFromFormData(formData: FormData): WeekPayload {
  const days: DayHoursPayload[] = [];
  const fieldErrors: Record<string, string> = {};

  for (const dayOfWeek of DAYS_OF_WEEK) {
    // An unchecked checkbox submits nothing at all, so absence is a real
    // "not closed" rather than "not supplied".
    if (checkboxField(formData.get(`${dayOfWeek}-closed`))) {
      // A closed day carries no times — one representation of closed, matching
      // the API schema and the database CHECK constraint.
      days.push({ dayOfWeek, isClosed: true });
      continue;
    }

    const opensAt = fromTimeInputValue(textField(formData.get(`${dayOfWeek}-opens`)));
    const closesAt = fromTimeInputValue(textField(formData.get(`${dayOfWeek}-closes`)));

    // Reported per field so the message lands on the input that caused it,
    // rather than as one line above a form with fourteen of them.
    if (opensAt === null) fieldErrors[`${dayOfWeek}-opens`] = "Enter an opening time";
    if (closesAt === null) fieldErrors[`${dayOfWeek}-closes`] = "Enter a closing time";

    days.push({ dayOfWeek, isClosed: false, opensAt, closesAt });
  }

  return { days, fieldErrors };
}

/**
 * Re-keys the shared schema's positional issue paths onto this form's fields.
 *
 * `@repo/validation` reports `days.4.closesAt`, because it validates an array.
 * The form's inputs are named `FRIDAY-closes`. Without this translation the
 * message would be correct and attached to nothing on screen.
 */
export function toHoursFieldErrors(
  issues: readonly { path: readonly (string | number | symbol)[]; message: string }[],
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const issue of issues) {
    const index = issue.path[1];
    const property = issue.path[2];
    const day = typeof index === "number" ? DAYS_OF_WEEK[index] : undefined;

    if (!day) continue;

    const field =
      property === "opensAt" ? "opens" : property === "closesAt" ? "closes" : "closed";
    const key = `${day}-${field}`;

    if (!errors[key]) errors[key] = issue.message;
  }

  return errors;
}
