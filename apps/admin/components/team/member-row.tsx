"use client";

import { useActionState } from "react";
import { Badge } from "@repo/ui/badge";
import { FormMessage, SubmitButton } from "@/components/forms/form-feedback";
import { removeMemberAction, updateMemberRoleAction } from "@/lib/actions/member-actions";
import type { TeamMember } from "@/lib/api/members";
import { idleFormState } from "@/lib/forms/state";

interface MemberRowProps {
  restaurantId: string;
  member: TeamMember;
  /** From the API's role — presentation only. */
  canManage: boolean;
  /** Whether this row is the signed-in user. */
  isSelf: boolean;
  /** Whether this member is the only owner left. */
  isLastOwner: boolean;
}

/**
 * One person on the team, with whatever controls their viewer may use.
 *
 * ─── Why some controls are absent rather than disabled-on-click ─────────────
 *
 * Three rules make a control useless before it is pressed: staff may not manage
 * anyone, nobody may change their own role, and the last owner may be neither
 * demoted nor removed. In each case the control is replaced by a sentence
 * saying why, because a button that always fails teaches nothing and a disabled
 * button with no explanation is worse.
 *
 * The backend enforces all three independently. This is presentation.
 */
export function MemberRow({
  restaurantId,
  member,
  canManage,
  isSelf,
  isLastOwner,
}: MemberRowProps) {
  const [roleState, roleAction] = useActionState(
    updateMemberRoleAction.bind(null, restaurantId, member.userId),
    idleFormState,
  );
  const [removeState, removeAction] = useActionState(
    removeMemberAction.bind(null, restaurantId, member.userId),
    idleFormState,
  );

  const nextRole = member.role === "OWNER" ? "STAFF" : "OWNER";
  // Self-change is refused for everyone; the last owner cannot lose the role.
  const mayChangeRole = canManage && !isSelf && !isLastOwner;
  const mayRemove = canManage && !isLastOwner;

  return (
    <li className="flex flex-col gap-3 border-b border-border py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-medium text-foreground">{member.user.name}</p>
          {member.role === "OWNER" ? (
            <Badge variant="success">Owner</Badge>
          ) : (
            <Badge variant="neutral">Staff</Badge>
          )}
          {isSelf ? <span className="text-sm text-muted-foreground">(you)</span> : null}
        </div>
        <p className="truncate text-sm text-muted-foreground">{member.user.email}</p>
      </div>

      {canManage ? (
        <div className="flex flex-col items-start gap-2 sm:items-end">
          {mayChangeRole ? (
            <form action={roleAction}>
              <input type="hidden" name="role" value={nextRole} />
              <SubmitButton pendingLabel="Saving…" variant="secondary">
                {nextRole === "OWNER" ? "Make owner" : "Make staff"}
              </SubmitButton>
            </form>
          ) : null}

          {mayRemove ? (
            <form action={removeAction}>
              <SubmitButton pendingLabel="Removing…" variant="ghost">Remove</SubmitButton>
            </form>
          ) : null}

          {isLastOwner ? (
            <p className="max-w-xs text-sm text-muted-foreground sm:text-right">
              The only owner cannot be removed or changed. Make someone else an owner
              first.
            </p>
          ) : null}

          {isSelf && !isLastOwner ? (
            <p className="max-w-xs text-sm text-muted-foreground sm:text-right">
              You cannot change your own role. Another owner can.
            </p>
          ) : null}

          <FormMessage state={roleState} />
          <FormMessage state={removeState} />
        </div>
      ) : null}
    </li>
  );
}
