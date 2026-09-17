"use client";

import { useActionState, useState } from "react";
import {
  DAY_LABELS,
  formatDayHoursLabel,
  toTimeInputValue,
  type DayHours,
} from "@repo/ui/lib/opening-hours";
import { FormMessage, SubmitButton } from "@/components/forms/form-feedback";
import { replaceHoursAction } from "@/lib/actions/hours-actions";
import { idleFormState, type FormState } from "@/lib/forms/state";

/**
 * The weekly opening-hours editor.
 *
 * One row per day, each a real `<input type="time">`: it is keyboard-operable,
 * respects the reader's 12/24-hour preference, and on a phone opens the
 * platform's own time picker — all of which a custom dropdown would have to
 * rebuild badly.
 *
 * A Client Component because each row toggles between "closed" and a pair of
 * times, and because the action's result is rendered inline. The whole editor
 * is still one form posting to one Server Action, so the week is saved
 * atomically rather than a day at a time.
 */
export function HoursForm({
  restaurantId,
  days,
  timeZone,
}: {
  restaurantId: string;
  days: DayHours[];
  timeZone: string;
}) {
  const [state, formAction] = useActionState(
    replaceHoursAction.bind(null, restaurantId),
    idleFormState,
  );

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <FormMessage state={state} />

      <p className="text-sm text-muted-foreground">
        Times are in the restaurant&apos;s own time zone ({timeZone}), so they stay
        correct for customers wherever they are reading from. Change the zone in
        the details above.
      </p>

      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {days.map((day) => (
          <li key={day.dayOfWeek}>
            <DayRow day={day} state={state} />
          </li>
        ))}
      </ul>

      <div>
        <SubmitButton>Save hours</SubmitButton>
      </div>
    </form>
  );
}

function DayRow({ day, state }: { day: DayHours; state: FormState }) {
  // Local state so the row switches immediately, without a round trip. The
  // server still decides what is stored — this only controls what is shown.
  const [isClosed, setIsClosed] = useState(day.isClosed);

  const label = DAY_LABELS[day.dayOfWeek];
  const opensError = state.fieldErrors?.[`${day.dayOfWeek}-opens`];
  const closesError = state.fieldErrors?.[`${day.dayOfWeek}-closes`];

  return (
    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4">
      <p className="w-28 shrink-0 text-sm font-medium text-foreground">{label}</p>

      <label
        htmlFor={`${day.dayOfWeek}-closed`}
        className="flex min-h-11 cursor-pointer items-center gap-2 sm:w-28"
      >
        <input
          type="checkbox"
          id={`${day.dayOfWeek}-closed`}
          name={`${day.dayOfWeek}-closed`}
          checked={isClosed}
          onChange={(event) => setIsClosed(event.target.checked)}
          className="size-4 rounded border-input accent-[var(--primary)]"
        />
        <span className="text-sm text-foreground">Closed</span>
      </label>

      {isClosed ? (
        <p className="text-sm text-muted-foreground">Closed all day</p>
      ) : (
        <div className="flex flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <TimeInput
              name={`${day.dayOfWeek}-opens`}
              label={`${label} opening time`}
              defaultValue={day.opensAt === null ? "09:00" : toTimeInputValue(day.opensAt)}
              invalid={Boolean(opensError)}
            />
            <span aria-hidden="true" className="text-muted-foreground">
              –
            </span>
            <TimeInput
              name={`${day.dayOfWeek}-closes`}
              label={`${label} closing time`}
              defaultValue={day.closesAt === null ? "17:00" : toTimeInputValue(day.closesAt)}
              invalid={Boolean(closesError)}
            />

            {/*
              Without this, a saved 22:00–02:00 looks like a data-entry error
              the owner is about to "fix". It is words, not a colour or an icon.
            */}
            {day.isOvernight ? (
              <span className="rounded-full border border-input px-2.5 py-0.5 text-xs text-muted-foreground">
                Overnight — closes the next day
              </span>
            ) : null}
          </div>

          {opensError || closesError ? (
            <p className="text-sm text-destructive">{opensError ?? closesError}</p>
          ) : null}

          {/*
            The saved value spelled out, so a screen-reader user can confirm
            what is currently stored without parsing two separate inputs.
          */}
          <p className="sr-only">Currently saved: {formatDayHoursLabel(day)}</p>
        </div>
      )}
    </div>
  );
}

/**
 * A time field whose label is visually hidden.
 *
 * The day name is already on the row, so a visible "Opening time" beside every
 * input would be fourteen redundant labels. The label still exists in the
 * accessibility tree — and names the *day* — because a screen-reader user
 * tabbing through fourteen unlabelled time fields has no way to tell which row
 * they are on.
 */
function TimeInput({
  name,
  label,
  defaultValue,
  invalid,
}: {
  name: string;
  label: string;
  defaultValue: string;
  invalid: boolean;
}) {
  return (
    <>
      <label htmlFor={name} className="sr-only">
        {label}
      </label>
      <input
        type="time"
        id={name}
        name={name}
        defaultValue={defaultValue}
        aria-invalid={invalid || undefined}
        className="h-11 rounded-md border border-input bg-background px-3 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-invalid:border-destructive"
      />
    </>
  );
}
