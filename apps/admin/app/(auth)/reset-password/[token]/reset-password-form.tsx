"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/forms/form-feedback";
import { TextField } from "@/components/forms/text-field";
import { resetPasswordAction } from "@/lib/auth/actions";
import { idleFormState } from "@/lib/forms/state";

/**
 * Sets a new password from a reset link.
 *
 * Both fields use `autoComplete="new-password"` so a password manager offers to
 * generate and store one rather than filling the old value it already has.
 */
export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction] = useActionState(
    // Bound rather than submitted, so the token never becomes a form field.
    resetPasswordAction.bind(null, token),
    idleFormState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <TextField
        name="password"
        label="New password"
        type="password"
        autoComplete="new-password"
        required
        minLength={12}
        error={state.fieldErrors?.password}
        hint="At least 12 characters."
      />

      <TextField
        name="confirmPassword"
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        required
        error={state.fieldErrors?.confirmPassword}
      />

      <FormMessage state={state} />

      <SubmitButton pendingLabel="Saving…">Set new password</SubmitButton>
    </form>
  );
}
