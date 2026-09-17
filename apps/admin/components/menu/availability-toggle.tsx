"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { FormMessage } from "@/components/forms/form-feedback";
import { idleFormState, type FormState } from "@/lib/forms/state";

/**
 * One-click sold-out toggle.
 *
 * The single most-used control during service, so it sits in the list rather
 * than behind the edit form. It flips `isAvailable` only: the dish stays on the
 * published menu, marked "Unavailable today", because a dish that silently
 * disappears makes a customer think the menu is broken.
 *
 * A form posting to a Server Action rather than an optimistic client update.
 * Optimism is wrong here — someone marking a dish sold out mid-service needs to
 * know it *actually* took effect, and a UI that shows success before the write
 * lands can quietly lie about that.
 */
export function AvailabilityToggle({
  action,
  isAvailable,
  itemName,
}: {
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
  isAvailable: boolean;
  itemName: string;
}) {
  const [state, formAction] = useActionState(action, idleFormState);

  return (
    <div className="flex flex-col items-start gap-1">
      <form action={formAction}>
        <ToggleButton isAvailable={isAvailable} itemName={itemName} />
      </form>

      {state.status === "error" ? <FormMessage state={state} /> : null}
    </div>
  );
}

function ToggleButton({ isAvailable, itemName }: { isAvailable: boolean; itemName: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      /*
        The visible label is short enough for a dense list; the accessible name
        includes the dish, because a screen-reader user moving through twenty
        identical "Mark sold out" buttons cannot otherwise tell which row they
        are on.
      */
      aria-label={
        isAvailable ? `Mark ${itemName} as sold out` : `Mark ${itemName} as available`
      }
      className="inline-flex h-11 items-center rounded-md border border-input px-3 text-sm font-medium text-foreground hover:bg-secondary disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {pending ? "Saving…" : isAvailable ? "Mark sold out" : "Mark available"}
    </button>
  );
}
