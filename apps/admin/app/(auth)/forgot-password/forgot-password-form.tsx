"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/forms/form-feedback";
import { TextField } from "@/components/forms/text-field";
import { requestPasswordResetAction } from "@/lib/auth/actions";
import { idleFormState } from "@/lib/forms/state";

/**
 * Asks for a reset link.
 *
 * ─── Why the outcome is always the same ─────────────────────────────────────
 *
 * The confirmation never says whether the address is registered. "No account
 * with that address" would turn this form into an account-enumeration tool
 * usable by anyone, and the API deliberately refuses to make that distinction —
 * it even simulates the token work for unknown addresses so the timing matches.
 * Leaking it here would make all of that pointless.
 *
 * The message is phrased to be true either way, so nobody is misled into
 * waiting for mail that is not coming without also being told why it might not.
 */
export function ForgotPasswordForm() {
  const [state, formAction] = useActionState(requestPasswordResetAction, idleFormState);

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

      <SubmitButton pendingLabel="Sending…">Send reset link</SubmitButton>
    </form>
  );
}
