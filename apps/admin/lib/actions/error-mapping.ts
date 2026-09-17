import { redirect } from "next/navigation";
import {
  ApiError,
  AuthRequiredError,
  ValidationError,
} from "../api/client";
import { formError, type FormState } from "../forms/state";

/**
 * Turns a failed API call into something a form can render.
 *
 * One place, so every action reports failures identically — and so no action
 * can accidentally leak an internal message by writing its own handling.
 */
export function toFormState(error: unknown): FormState {
  // An expired session cannot be fixed by re-reading the form, so it is not
  // reported as a form error. Sending the user to sign in is the only useful
  // response, and `redirect` throws, so this never returns.
  if (error instanceof AuthRequiredError) {
    redirect("/login");
  }

  // The API's field-level issues, attached to the inputs they belong to.
  if (error instanceof ValidationError) {
    return formError(error.message, error.fieldErrors);
  }

  /*
   * Every other `ApiError` carries a message written for a person: which slug
   * clashed, how many items block a delete, that access was refused. Those are
   * exactly what the user needs. Anything that is *not* an `ApiError` reached
   * here unexpectedly, so it is logged and replaced with a generic line —
   * never rendered, since it could carry internals.
   */
  if (error instanceof ApiError) {
    return formError(error.message);
  }

  console.error("[admin-action] unexpected failure", { error });
  return formError("Something went wrong. Please try again.");
}
