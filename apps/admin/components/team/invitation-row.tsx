"use client";

import { useActionState } from "react";
import { Badge } from "@repo/ui/badge";
import { FormMessage, SubmitButton } from "@/components/forms/form-feedback";
import { cancelInvitationAction } from "@/lib/actions/member-actions";
import type { PendingInvitation } from "@/lib/api/members";
import { idleFormState } from "@/lib/forms/state";

/**
 * One pending invitation.
 *
 * The token is not here, and could not be — the API's projection cannot return
 * it. Only the address, the offered role and when the link stops working.
 */
export function InvitationRow({
  restaurantId,
  invitation,
  canManage,
  hasExpired,
}: {
  restaurantId: string;
  invitation: PendingInvitation;
  canManage: boolean;
  /*
   * Decided on the server rather than from `Date.now()` during render.
   * Reading the clock while rendering is impure: the server and the browser
   * can land on different answers either side of the expiry instant, which is
   * a hydration mismatch on exactly the row the reader cares about.
   */
  hasExpired: boolean;
}) {
  const [state, action] = useActionState(
    cancelInvitationAction.bind(null, restaurantId, invitation.id),
    idleFormState,
  );

  const expiresAt = new Date(invitation.expiresAt);

  return (
    <li className="flex flex-col gap-3 border-b border-border py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-medium text-foreground">{invitation.email}</p>
          {invitation.role === "OWNER" ? (
            <Badge variant="success">Owner</Badge>
          ) : (
            <Badge variant="neutral">Staff</Badge>
          )}
          {/*
            An expired invitation is stated in words, not implied by a date the
            reader has to compare against today. It is kept on screen rather
            than hidden, so the fix — invite again — is obvious.
          */}
          {hasExpired ? <Badge variant="neutral">Expired</Badge> : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {hasExpired ? "Expired " : "Expires "}
          <time dateTime={invitation.expiresAt}>
            {expiresAt.toLocaleDateString(undefined, {
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
          </time>
          {hasExpired ? " — invite again to send a new link." : null}
        </p>
      </div>

      {canManage ? (
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <form action={action}>
            <SubmitButton pendingLabel="Withdrawing…" variant="ghost">
              Withdraw
            </SubmitButton>
          </form>
          <FormMessage state={state} />
        </div>
      ) : null}
    </li>
  );
}
