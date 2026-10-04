"use client";

import { useActionState } from "react";
import { Label } from "@repo/ui/label";
import { FormMessage, SubmitButton } from "@/components/forms/form-feedback";
import { TextField } from "@/components/forms/text-field";
import { inviteMemberAction } from "@/lib/actions/member-actions";
import { idleFormState } from "@/lib/forms/state";

/**
 * Invites someone to the team.
 *
 * ─── Why this says so little about the outcome ──────────────────────────────
 *
 * On success it reports only that an invitation was sent. It deliberately does
 * not say whether the address already had an account, because that answer —
 * available to anyone who can invite, for any address they care to type — is
 * precisely the account-enumeration oracle the invitation design avoids.
 */
export function InviteForm({ restaurantId }: { restaurantId: string }) {
  const [state, formAction] = useActionState(
    inviteMemberAction.bind(null, restaurantId),
    idleFormState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <TextField
        name="email"
        label="Email address"
        type="email"
        autoComplete="off"
        required
        error={state.fieldErrors?.email}
        hint="They will get a link that expires in 7 days and works once."
      />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="invite-role">Role</Label>
        {/*
          A plain select rather than a custom control: two options, native
          keyboard behaviour, and nothing to get wrong on a phone.

          Staff is first and selected by default. Owner is the choice that
          cannot be undone by the inviter alone — an owner can demote anyone
          except the last one — so it should be chosen deliberately, never by
          an absent-minded accept of whatever was pre-selected.
        */}
        <select
          id="invite-role"
          name="role"
          defaultValue="STAFF"
          className="h-11 rounded-md border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <option value="STAFF">Staff — can edit the menu and profile</option>
          <option value="OWNER">Owner — can also manage the team and delete</option>
        </select>
        <p className="text-sm text-muted-foreground">
          You can change this later, except for the last owner.
        </p>
      </div>

      <FormMessage state={state} />

      <div>
        <SubmitButton pendingLabel="Sending…">Send invitation</SubmitButton>
      </div>
    </form>
  );
}
