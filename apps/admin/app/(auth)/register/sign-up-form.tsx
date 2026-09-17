"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/forms/form-feedback";
import { TextField } from "@/components/forms/text-field";
import { signUpAction } from "@/lib/auth/actions";
import { idleFormState } from "@/lib/forms/state";

export function SignUpForm() {
  const [state, formAction] = useActionState(signUpAction, idleFormState);

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <FormMessage state={state} />

      <TextField
        name="name"
        label="Your name"
        required
        autoComplete="name"
        maxLength={120}
        error={state.fieldErrors?.name}
      />

      <TextField
        name="email"
        label="Email"
        type="email"
        required
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        error={state.fieldErrors?.email}
      />

      <TextField
        name="password"
        label="Password"
        type="password"
        required
        autoComplete="new-password"
        minLength={12}
        // The rule is stated up front rather than only after a rejected
        // submission — a requirement you discover by failing is a bad
        // requirement.
        hint="At least 12 characters. A short phrase you'll remember works well."
        error={state.fieldErrors?.password}
      />

      <SubmitButton fullWidth pendingLabel="Creating account…">
        Create account
      </SubmitButton>
    </form>
  );
}
