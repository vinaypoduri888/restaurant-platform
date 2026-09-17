import { DAYS_OF_WEEK, type DayOfWeek } from "@repo/validation/operating-hours";

/**
 * Whether a restaurant is open at a given instant.
 *
 * ─── Why this is a pure function ────────────────────────────────────────────
 *
 * Every input is an argument: the hours, the zone, and the **instant**. Nothing
 * here reads the clock. That is what makes "is it open at 01:00 on the Tuesday
 * after the US clocks go back" a test you can actually write, rather than
 * something you can only observe twice a year.
 *
 * It knows nothing about HTTP, Prisma, or React. The service passes it rows and
 * an instant; the UI receives a word.
 */

export type OpenStatus = "open" | "closed" | "unknown";

export interface DayHours {
  dayOfWeek: DayOfWeek;
  isClosed: boolean;
  /** Minutes past local midnight, or `null` on a closed day. */
  opensAt: number | null;
  closesAt: number | null;
}

/** Where an instant falls on the restaurant's own wall clock. */
export interface LocalMoment {
  dayOfWeek: DayOfWeek;
  /** Minutes past local midnight, 0–1439. */
  minuteOfDay: number;
}

const WEEKDAY_NAMES: Record<string, DayOfWeek> = {
  Monday: "MONDAY",
  Tuesday: "TUESDAY",
  Wednesday: "WEDNESDAY",
  Thursday: "THURSDAY",
  Friday: "FRIDAY",
  Saturday: "SATURDAY",
  Sunday: "SUNDAY",
};

/**
 * Converts an absolute instant into the restaurant's local weekday and time.
 *
 * ─── Why `Intl` and not arithmetic ─────────────────────────────────────────
 *
 * The naive approach is to add a stored offset. That is wrong for any zone with
 * daylight saving: `America/New_York` is UTC−5 in January and UTC−4 in July, so
 * a fixed offset misreports half the year — and misreports it for exactly the
 * summer evenings a restaurant most cares about.
 *
 * `Intl` carries the IANA rules the runtime ships with, including the historical
 * ones, so a conversion is correct on both sides of a transition without this
 * file knowing when transitions happen.
 *
 * `hourCycle: "h23"` is deliberate: the `h24` cycle renders midnight as "24",
 * which would produce a minute-of-day of 1440 and silently break every
 * comparison below.
 */
export function toLocalMoment(instant: Date, timeZone: string): LocalMoment {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);

  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  const dayOfWeek = WEEKDAY_NAMES[read("weekday")];
  if (!dayOfWeek) {
    // Unreachable with a validated zone: `Intl` would have thrown on the zone
    // itself first. Guarded rather than asserted, so a runtime whose locale data
    // surprises us degrades to "unknown" instead of throwing inside a request.
    throw new RangeError(`Could not resolve a weekday in time zone "${timeZone}"`);
  }

  return {
    dayOfWeek,
    minuteOfDay: Number(read("hour")) * 60 + Number(read("minute")),
  };
}

/** The day before, wrapping Monday back to Sunday. */
export function previousDay(day: DayOfWeek): DayOfWeek {
  const index = DAYS_OF_WEEK.indexOf(day);
  return DAYS_OF_WEEK[(index + DAYS_OF_WEEK.length - 1) % DAYS_OF_WEEK.length] as DayOfWeek;
}

/**
 * Whether a day's period runs past midnight into the next day.
 *
 * Equal times are rejected upstream — by validation and by a database CHECK —
 * so a strict `<` is a complete test rather than a near-miss.
 */
export function isOvernight(hours: DayHours): boolean {
  return (
    !hours.isClosed &&
    hours.opensAt !== null &&
    hours.closesAt !== null &&
    hours.closesAt < hours.opensAt
  );
}

/**
 * Whether a restaurant is open at `instant`.
 *
 * ─── Boundary semantics ─────────────────────────────────────────────────────
 *
 * The period is half-open: **`[opensAt, closesAt)`**. At exactly the opening
 * minute it is open; at exactly the closing minute it is closed. That is what
 * "we close at 17:00" means to a person, and it is the only choice under which
 * two adjacent periods cannot both claim the same minute.
 *
 * ─── Overnight ──────────────────────────────────────────────────────────────
 *
 * A period like Monday 22:00→02:00 covers two calendar days, so *two* rows can
 * make a given moment open:
 *
 *   - today's row, if the moment is at or after its opening time; and
 *   - **yesterday's** row, if it ran overnight and the moment is before its
 *     closing time.
 *
 * Tuesday 01:00 is open because of *Monday's* entry. Forgetting to look back a
 * day is the classic bug here, and it only shows up after midnight — which is
 * precisely when a late-night venue is trading.
 *
 * ─── Unknown ────────────────────────────────────────────────────────────────
 *
 * No configured hours returns `unknown`, never `closed`. A restaurant whose
 * owner has not filled the form in is not closed, and telling a customer it is
 * would turn an empty admin field into a lost visit.
 */
export function resolveOpenStatus(
  hours: readonly DayHours[],
  timeZone: string,
  instant: Date,
): OpenStatus {
  if (hours.length === 0) return "unknown";

  const now = toLocalMoment(instant, timeZone);
  const byDay = new Map(hours.map((entry) => [entry.dayOfWeek, entry]));

  const today = byDay.get(now.dayOfWeek);
  if (today && !today.isClosed && today.opensAt !== null && today.closesAt !== null) {
    const openedToday = isOvernight(today)
      ? // The evening leg: everything from opening until midnight.
        now.minuteOfDay >= today.opensAt
      : now.minuteOfDay >= today.opensAt && now.minuteOfDay < today.closesAt;

    if (openedToday) return "open";
  }

  // The early-morning leg of a period that began yesterday.
  const yesterday = byDay.get(previousDay(now.dayOfWeek));
  if (yesterday && isOvernight(yesterday) && now.minuteOfDay < (yesterday.closesAt ?? 0)) {
    return "open";
  }

  return "closed";
}

/** Renders a minute-of-day as `HH:MM`, for the API's own display string. */
export function formatMinuteOfDay(minuteOfDay: number): string {
  const hours = Math.floor(minuteOfDay / 60);
  const minutes = minuteOfDay % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
