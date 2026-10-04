"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/forms/form-feedback";
import { TextField } from "@/components/forms/text-field";
import { resendVerificationAction } from "@/lib/auth/actions";
import { idleFormState } from "@/lib/forms/state";

/**
 * Requests another confirmation email.
 *
 * Like the reset form, the outcome is reported identically whether or not the
 * address exists or still needs confirming — otherwise this becomes a way to
 * ask "is this address registered, and has it been verified?", which is two
 * facts about someone else's account.
 */
export function ResendVerificationForm() {
  const [state, formAction] = useActionState(resendVerificationAction, idleFormState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <TextField
        name="email"
        label="Email address"
        type="email"
        autoComplete="email"
        required
        error={state.fieldErrors?.email}
      />

      <FormMessage state={state} />

      <SubmitButton pendingLabel="Sending…">Send a new link</SubmitButton>
    </form>
  );
}
