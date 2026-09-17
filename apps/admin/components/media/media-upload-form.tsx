"use client";

import { useActionState, useId, useRef, useState } from "react";
import { Label } from "@repo/ui/label";
import { FormMessage, SubmitButton } from "@/components/forms/form-feedback";
import { uploadMediaAction } from "@/lib/actions/media-actions";
import type { MediaPurpose } from "@/lib/api/media";
import {
  ACCEPT_ATTRIBUTE,
  ACCEPTED_FORMATS_LABEL,
  MEDIA_MAX_DIMENSION,
  formatMaxSize,
  preCheckFile,
} from "@/lib/api/media-constraints";
import { idleFormState } from "@/lib/forms/state";

/**
 * The file picker for one branding slot.
 *
 * A Client Component because it needs `useActionState` to render the server's
 * response and to give immediate feedback on an obviously-wrong file. The input
 * is an ordinary `<input type="file">`, so the system picker, keyboard
 * operation and screen-reader behaviour are the platform's rather than
 * something reimplemented here.
 */
export function MediaUploadForm({
  restaurantId,
  purpose,
  hasExisting,
}: {
  restaurantId: string;
  purpose: MediaPurpose;
  hasExisting: boolean;
}) {
  const [state, formAction] = useActionState(
    uploadMediaAction.bind(null, restaurantId, purpose),
    idleFormState,
  );

  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const localErrorId = `${inputId}-error`;
  const inputRef = useRef<HTMLInputElement>(null);

  // Feedback before any request is made — the API still re-validates the bytes.
  const [localError, setLocalError] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);

  function onChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setSelectedName(file?.name ?? null);
    setLocalError(file ? preCheckFile(file) : null);
  }

  const described = [hintId, localError ? localErrorId : null].filter(Boolean).join(" ");

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3"
      onSubmit={() => {
        // Clear any stale local complaint as the request starts, so the
        // server's answer is the only message on screen afterwards.
        setLocalError(null);
      }}
    >
      <FormMessage state={state} />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={inputId}>
          {hasExisting ? "Replace image" : "Upload image"}
        </Label>

        <input
          ref={inputRef}
          id={inputId}
          name="file"
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          onChange={onChange}
          aria-invalid={localError ? true : undefined}
          aria-describedby={described || undefined}
          /*
            `file:` variants style the button inside the control. The control
            itself keeps a 44px minimum height so it is a comfortable touch
            target, and the focus ring is the shared one so keyboard position
            is always visible.
          */
          className="block w-full min-h-11 cursor-pointer rounded-md border border-input bg-background px-3 py-2 text-base text-foreground file:mr-3 file:cursor-pointer file:rounded file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-secondary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        />

        {/*
          The constraints are stated up front, not discovered by failing. These
          mirror the API's limits for display only — the API enforces them.
        */}
        <p id={hintId} className="text-sm text-muted-foreground">
          {ACCEPTED_FORMATS_LABEL}, up to {formatMaxSize()} and{" "}
          {MEDIA_MAX_DIMENSION}×{MEDIA_MAX_DIMENSION} pixels.
          {hasExisting ? " Uploading replaces the current image." : ""}
        </p>

        {localError ? (
          // `role="alert"`: the person has just acted and needs to know the
          // file will not do, before they press a button that would fail.
          <p id={localErrorId} role="alert" className="text-sm text-destructive">
            {localError}
          </p>
        ) : null}

        {selectedName && !localError ? (
          <p className="truncate text-sm text-muted-foreground">
            Selected: {selectedName}
          </p>
        ) : null}
      </div>

      <div>
        <SubmitButton
          // Disabled while a local problem stands: submitting could only fail.
          disabled={Boolean(localError)}
          pendingLabel="Uploading…"
        >
          {hasExisting ? "Replace" : "Upload"}
        </SubmitButton>
      </div>
    </form>
  );
}
