"use client";

import { useActionState } from "react";
import Link from "next/link";
import { FormMessage, SubmitButton } from "@/components/forms/form-feedback";
import { acceptInvitationAction } from "@/lib/actions/member-actions";
import { idleFormState } from "@/lib/forms/state";

/**
 * The accept button.
 *
 * A form rather than a link, because accepting creates a membership — a
 * state change, which must not happen on a GET that a mail client, a link
 * previewer or a browser prefetch could fire on the recipient's behalf.
 *
 * The token is bound into the action rather than submitted, so it never becomes
 * a form field.
 */
export function AcceptInvitationForm({
  token,
  restaurantName,
}: {
  token: string;
  restaurantName: string;
}) {
  const [state, formAction] = useActionState(
    acceptInvitationAction.bind(null, token),
    idleFormState,
  );

  const joined = state.status === "success";

  return (
    <div className="flex flex-col gap-4">
      <FormMessage state={state} />

      {joined ? (
        <p className="text-sm">
          <Link
            href="/"
            className="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Go to {restaurantName}
          </Link>
        </p>
      ) : (
        <form action={formAction}>
          <SubmitButton pendingLabel="Joining…">Accept invitation</SubmitButton>
        </form>
      )}
    </div>
  );
}
