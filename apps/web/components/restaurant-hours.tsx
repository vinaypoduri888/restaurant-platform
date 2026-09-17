import {
  DAY_LABELS,
  formatDayHours,
  formatDayHoursLabel,
  type DayHours,
  type OpenStatus,
} from "@repo/ui/lib/opening-hours";
import { OpenStatusBadge } from "./open-status-badge";

/**
 * Opening hours and whether the restaurant is open right now.
 *
 * A Server Component that renders an answer the **API** already computed. No
 * time-zone arithmetic happens in the browser, and none happens here: a visitor
 * in London reading a Mumbai menu must be told whether it is open in Mumbai,
 * and their device cannot know that.
 *
 * Placed after the header and before the menu, so someone who has just scanned
 * a code learns "am I in the right place, and is it open?" before scrolling.
 */
export function RestaurantHours({
  status,
  hours,
  timeZone,
}: {
  status: OpenStatus;
  hours: DayHours[];
  timeZone: string;
}) {
  // Nothing configured: no badge, no empty table, no "closed" that would be a
  // guess. The section simply does not appear.
  if (hours.length === 0) return null;

  return (
    <section aria-labelledby="hours-heading" className="w-full">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id="hours-heading" className="text-xl font-semibold tracking-tight sm:text-2xl">
          Opening hours
        </h2>
        <OpenStatusBadge status={status} />
      </div>

      {/*
        A description list, not a table: each day is a term and its hours are
        the description. Assistive technology then pairs them, instead of
        reading fourteen unrelated strings.
      */}
      <dl className="mt-4 divide-y divide-border rounded-xl border border-border">
        {hours.map((day) => (
          <DayRow key={day.dayOfWeek} day={day} />
        ))}
      </dl>

      <p className="mt-3 text-sm text-muted-foreground">
        Times shown in the restaurant&apos;s local time ({timeZone}).
      </p>
    </section>
  );
}

function DayRow({ day }: { day: DayHours }) {
  const closed = day.isClosed || day.opensAt === null || day.closesAt === null;

  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-3">
      <dt className="text-sm font-medium text-foreground">{DAY_LABELS[day.dayOfWeek]}</dt>

      {/*
        The visible text is compact; the label spells the range out, because a
        screen reader renders an en dash inconsistently and an overnight period
        otherwise sounds like an error rather than a late shift.
      */}
      <dd
        aria-label={formatDayHoursLabel(day)}
        className={
          closed
            ? "text-sm tabular-nums text-muted-foreground"
            : "text-sm tabular-nums text-foreground"
        }
      >
        <span aria-hidden="true">{formatDayHours(day)}</span>

        {day.isOvernight ? (
          /*
            Without this, 22:00 – 02:00 reads as an invalid interval. The
            marker is text, not a colour or an icon, so it survives being read
            aloud and being seen by someone who cannot distinguish colours.
          */
          <span aria-hidden="true" className="ml-2 text-xs text-muted-foreground">
            (next day)
          </span>
        ) : null}
      </dd>
    </div>
  );
}
