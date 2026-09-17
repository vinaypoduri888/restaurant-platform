/**
 * The shape every Server Action returns to a form.
 *
 * One shape for all of them means one set of form components can render
 * validation errors, server errors, and success feedback without each form
 * inventing its own protocol.
 */
export interface FormState {
  status: "idle" | "success" | "error";
  /** A message about the request as a whole, not about one field. */
  message?: string;
  /** Field name → message, so an error can sit next to the input it concerns. */
  fieldErrors?: Record<string, string>;
}

export const idleFormState: FormState = { status: "idle" };

export function formError(message: string, fieldErrors?: Record<string, string>): FormState {
  return { status: "error", message, fieldErrors };
}

export function formSuccess(message: string): FormState {
  return { status: "success", message };
}

/**
 * Converts a Zod `safeParse` failure into field errors.
 *
 * Only the first issue per field is kept: showing a user three simultaneous
 * complaints about one input is noise, and they can only act on one at a time.
 */
export function fieldErrorsFromIssues(
  issues: readonly { path: readonly (string | number | symbol)[]; message: string }[],
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field === "string" && !errors[field]) {
      errors[field] = issue.message;
    }
  }

  return errors;
}

/**
 * Reads an optional text field from a form submission.
 *
 * An untouched input submits `""`, which is not the same as "leave unchanged"
 * and is also not a value worth storing. Returning `undefined` for empty input
 * lets the caller omit the field entirely, and the API's own schemas normalise
 * whitespace-only strings to `null`.
 */
export function optionalField(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Reads a required text field, preserving `""` so validation can reject it. */
export function textField(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

/** An HTML checkbox submits its value only when checked, and nothing when not. */
export function checkboxField(value: FormDataEntryValue | null): boolean {
  return value === "on" || value === "true";
}
