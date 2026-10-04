"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/forms/form-feedback";
import { TextField } from "@/components/forms/text-field";
import { signInAction } from "@/lib/auth/actions";
import { idleFormState } from "@/lib/forms/state";

/**
 * Sign-in form.
 *
 * A Client Component because it needs `useActionState` to render the server's
 * response. The credentials never touch application JavaScript beyond the input
 * elements themselves.
 *
 * One honest limitation, measured rather than assumed: a form inside a Client
 * Component does **not** get progressive enhancement here. Next embeds the
 * hidden `$ACTION_ID` for forms rendered by Server Components — verified by
 * inspecting both — so sign-out works with JavaScript disabled while this form
 * does not. Tracked as debt; the fix is a Server Component form with the errors
 * carried in `searchParams` instead of `useActionState`.
 *
 * Nothing is stored client-side. The session arrives as an `httpOnly` cookie
 * set by the action, which no script on this page can read.
 */
export function SignInForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState(
    // Bound rather than submitted: a hidden field carrying a redirect target
    // is editable by anything on the page, and this one decides where an
    // authenticated user lands.
    signInAction.bind(null, next),
    idleFormState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-5" noValidate>
      <FormMessage state={state} />

      <TextField
        name="email"
        label="Email"
        type="email"
        required
        autoComplete="email"
        // Genuinely useful on a phone: the right keyboard, and no capitalising
        // the first letter of an address.
        autoCapitalize="none"
        spellCheck={false}
        error={state.fieldErrors?.email}
      />

      <TextField
        name="password"
        label="Password"
        type="password"
        required
        // "current-password" lets a password manager offer the saved one;
        // "new-password" here would prompt to generate a new one instead.
        autoComplete="current-password"
        error={state.fieldErrors?.password}
      />

      <SubmitButton fullWidth pendingLabel="Signing in…">
        Sign in
      </SubmitButton>
    </form>
  );
}
