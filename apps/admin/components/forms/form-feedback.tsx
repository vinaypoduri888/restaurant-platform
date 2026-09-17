"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "@repo/ui/button";
import type { FormState } from "@/lib/forms/state";

/**
 * The pieces every admin form shares.
 *
 * Client Components, because they read `useFormStatus` — the pending state of
 * the form they sit inside. Keeping them small means the forms themselves stay
 * server-rendered markup with only these islands hydrating.
 */

/**
 * Submit button that disables and relabels itself while the action runs.
 *
 * Both matter: the disable prevents a double submission creating two
 * categories, and the label change is the feedback that tells someone on a slow
 * connection that their click registered. `aria-disabled` is not used in place
 * of `disabled` here because a genuinely inert control is what is wanted.
 */
export function SubmitButton({
  children,
  pendingLabel = "Saving…",
  ...props
}: ButtonProps & { pendingLabel?: string }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} {...props}>
      {pending ? pendingLabel : children}
    </Button>
  );
}

/**
 * The form-level message: a server error, or confirmation that a save worked.
 *
 * Errors are announced assertively (`role="alert"`) because the user's action
 * did not do what they asked and they need to know before doing anything else.
 * Success is polite (`role="status"`), so it does not interrupt someone already
 * moving on to the next field.
 */
export function FormMessage({ state }: { state: FormState }) {
  if (state.status === "idle" || !state.message) return null;

  const isError = state.status === "error";

  return (
    <p
      role={isError ? "alert" : "status"}
      className={[
        "rounded-md border px-3 py-2 text-sm",
        isError
          ? "border-destructive/40 bg-destructive/10 text-foreground"
          : "border-success/40 bg-success/10 text-foreground",
      ].join(" ")}
    >
      {state.message}
    </p>
  );
}

/**
 * A field-level error, wired to its input by id.
 *
 * The input references this element through `aria-describedby`, which is what
 * makes a screen reader read the error when focus reaches the field — rather
 * than the user discovering it only by finding the red text visually.
 */
export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;

  return (
    <p id={id} className="text-sm text-destructive">
      {message}
    </p>
  );
}
