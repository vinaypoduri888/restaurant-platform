"use client";

import { useActionState, useState } from "react";
import { FormMessage, SubmitButton } from "@/components/forms/form-feedback";
import type { FormState } from "@/lib/forms/state";
import { idleFormState } from "@/lib/forms/state";
import {
  DELETE_PERMISSION_HINT,
  DELETE_UNAVAILABLE_HINT,
} from "@/lib/api/permissions";

interface ConfirmDeleteProps {
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
  /** Button label before confirmation, e.g. "Delete category". */
  label: string;
  /** What will actually be destroyed, shown at the confirmation step. */
  confirmMessage: string;
  /**
   * Offers a second, explicit "delete its contents too" step when the API
   * refuses with 409. Only categories can be in that state.
   */
  allowForce?: boolean;
  /**
   * Whether the signed-in user's role permits deleting.
   *
   * Presentation only — the API re-authorizes the request regardless, and this
   * component still handles a 403 because a role can be revoked between the
   * page rendering and the button being pressed.
   */
  canDelete: boolean;
}

/**
 * Two-step delete.
 *
 * ─── Why not `window.confirm` ────────────────────────────────────────────────
 *
 * A native confirm is unstyleable, reads poorly to screen readers, is blocked
 * in some embedded browsers, and cannot show the API's own explanation of what
 * is about to happen. An in-page step can say "this deletes 8 menu items" —
 * which is the information that actually prevents the mistake.
 *
 * The first click reveals the confirmation; the second submits. Nothing is
 * destroyed by a single click, and the escape route is a plain Cancel button
 * rather than a dismissible overlay that can trap focus.
 *
 * When the API answers 409 (the category still holds items), its message is
 * shown verbatim — it names the count — and, if `allowForce` is set, a second
 * explicit option appears. `force` is never sent unless that option is used:
 * silently cascading is exactly what the backend's 409 exists to prevent.
 */
export function ConfirmDelete({
  action,
  label,
  confirmMessage,
  allowForce = false,
  canDelete,
}: ConfirmDeleteProps) {
  const [state, formAction] = useActionState(action, idleFormState);
  const [confirming, setConfirming] = useState(false);

  const blockedByContents = state.status === "error" && allowForce && mentionsContents(state.message);

  /*
    A control that always refuses is worse than no control: it looks like a bug
    rather than a boundary. Explaining the limit — and naming the reversible
    alternative — is more useful than a disabled button with no reason given.
  */
  if (!canDelete) {
    return <p className="text-sm text-muted-foreground">{DELETE_UNAVAILABLE_HINT}</p>;
  }

  if (!confirming) {
    return (
      <div className="flex flex-col gap-2">
        <FormMessage state={state} />
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="inline-flex h-11 items-center rounded-md px-3 text-sm font-medium text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {label}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3">
      <FormMessage state={state} />

      <p className="text-sm text-foreground">{confirmMessage}</p>
      <p className="text-sm text-muted-foreground">{DELETE_PERMISSION_HINT}</p>

      <div className="flex flex-wrap gap-2">
        <form action={formAction}>
          <SubmitButton variant="destructive" pendingLabel="Deleting…">
            Yes, delete
          </SubmitButton>
        </form>

        {blockedByContents ? (
          <form action={formAction}>
            {/*
              The only place `force` is ever set, and only after the API has
              already refused and explained why.
            */}
            <input type="hidden" name="force" value="true" />
            <SubmitButton variant="destructive" pendingLabel="Deleting…">
              Delete it and its items
            </SubmitButton>
          </form>
        ) : null}

        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="inline-flex h-11 items-center rounded-md border border-input px-3 text-sm font-medium text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Recognises the backend's "still contains N menu item(s)" refusal.
 *
 * Matching on the message is admittedly loose — the API returns a plain 409
 * with human-readable text rather than a machine-readable code. Getting it
 * wrong is safe in both directions: a missed match just means the extra option
 * is not offered, and a false match only reveals a button that still requires
 * a deliberate click.
 */
function mentionsContents(message?: string): boolean {
  return typeof message === "string" && /menu item/i.test(message);
}
