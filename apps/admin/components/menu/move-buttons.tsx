"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { FormMessage } from "@/components/forms/form-feedback";
import { idleFormState, type FormState } from "@/lib/forms/state";

interface MoveButtonsProps {
  moveUp: (previous: FormState, formData: FormData) => Promise<FormState>;
  moveDown: (previous: FormState, formData: FormData) => Promise<FormState>;
  /** What is being moved, for the button's accessible name. */
  itemName: string;
  isFirst: boolean;
  isLast: boolean;
}

/**
 * Reorder controls.
 *
 * Buttons rather than drag-and-drop, deliberately. The backend exposes
 * one-item `PATCH` and no bulk reorder endpoint, so a drag surface would still
 * have to issue the same two writes — while being unusable by keyboard and by
 * screen reader without a large amount of extra machinery. Buttons are
 * operable by everyone and match the contract exactly.
 *
 * Each button carries its own accessible name including the item ("Move
 * Starters up"), because a screen-reader user tabbing through a list of ten
 * identical "Move up" buttons has no way to tell which row they are on.
 */
export function MoveButtons({ moveUp, moveDown, itemName, isFirst, isLast }: MoveButtonsProps) {
  const [upState, upAction] = useActionState(moveUp, idleFormState);
  const [downState, downAction] = useActionState(moveDown, idleFormState);

  const failed = upState.status === "error" ? upState : downState.status === "error" ? downState : null;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1">
        <form action={upAction}>
          <MoveButton label={`Move ${itemName} up`} glyph="↑" disabled={isFirst} />
        </form>
        <form action={downAction}>
          <MoveButton label={`Move ${itemName} down`} glyph="↓" disabled={isLast} />
        </form>
      </div>

      {failed ? <FormMessage state={failed} /> : null}
    </div>
  );
}

function MoveButton({
  label,
  glyph,
  disabled,
}: {
  label: string;
  glyph: string;
  disabled: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={disabled || pending}
      // The arrow is decorative; this is the name assistive technology reads.
      aria-label={label}
      className="inline-flex size-11 items-center justify-center rounded-md border border-input text-foreground hover:bg-secondary disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
}
