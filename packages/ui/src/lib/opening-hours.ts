/**
 * Presentation helpers for operating hours, shared by the public site and the
 * admin console.
 *
 * **There is deliberately no time-zone arithmetic here.** Deciding whether a
 * restaurant is open requires converting an instant into the restaurant's own
 * local time, and that happens once, on the server, in the API. What reaches a
 * frontend is already a wall-clock time and an answer; these functions only
 * turn minutes into something a person reads.
 */

export type DayOfWeek =
  | "MONDAY"
  | "TUESDAY"
  | "WEDNESDAY"
  | "THURSDAY"
  | "FRIDAY"
  | "SATURDAY"
  | "SUNDAY";

export type OpenStatus = "open" | "closed" | "unknown";

export interface DayHours {
  dayOfWeek: DayOfWeek;
  isClosed: boolean;
  opensAt: number | null;
  closesAt: number | null;
  /** Derived by the API: the period runs past midnight into the next day. */
  isOvernight: boolean;
}

export const DAY_LABELS: Record<DayOfWeek, string> = {
  MONDAY: "Monday",
  TUESDAY: "Tuesday",
  WEDNESDAY: "Wednesday",
  THURSDAY: "Thursday",
  FRIDAY: "Friday",
  SATURDAY: "Saturday",
  SUNDAY: "Sunday",
};

/**
 * Renders a minute-of-day in the reader's locale — "9:00 AM" or "09:00".
 *
 * The `timeZone: "UTC"` is load-bearing and is **not** a conversion: the Date
 * is built at UTC midnight plus the given minutes, so formatting it as UTC
 * reproduces exactly those minutes. Omitting it would apply the viewer's own
 * offset and shift a restaurant's posted opening time by hours.
 */
export function formatTimeOfDay(minuteOfDay: number, locale?: string): string {
  const date = new Date(Date.UTC(2000, 0, 1, 0, minuteOfDay));

  return new Intl.DateTimeFormat(locale, {
    // Zero-padded rather than "numeric" so a week of hours lines up as a
    // column instead of ragging left, and so 00:00 does not render as "0:00".
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

/** The visible summary for one day: a range, or the word "Closed". */
export function formatDayHours(day: DayHours, locale?: string): string {
  if (day.isClosed || day.opensAt === null || day.closesAt === null) {
    return "Closed";
  }

  return `${formatTimeOfDay(day.opensAt, locale)} – ${formatTimeOfDay(day.closesAt, locale)}`;
}

/**
 * The spoken summary, for an `aria-label`.
 *
 * An en dash is read inconsistently — sometimes "to", sometimes silence — so
 * the words are supplied explicitly. The overnight case says so out loud,
 * because "10:00 PM to 2:00 AM" otherwise sounds like a mistake rather than a
 * late-night shift.
 */
export function formatDayHoursLabel(day: DayHours, locale?: string): string {
  const name = DAY_LABELS[day.dayOfWeek];

  if (day.isClosed || day.opensAt === null || day.closesAt === null) {
    return `${name}: closed`;
  }

  const range = `${formatTimeOfDay(day.opensAt, locale)} to ${formatTimeOfDay(day.closesAt, locale)}`;
  return day.isOvernight ? `${name}: ${range} the next day` : `${name}: ${range}`;
}

/** Human-readable status. Never colour alone — this is the text beside it. */
export const STATUS_LABELS: Record<OpenStatus, string> = {
  open: "Open now",
  closed: "Closed now",
  unknown: "Hours not available",
};

/** Converts minutes to the `HH:MM` value an `<input type="time">` expects. */
export function toTimeInputValue(minuteOfDay: number): string {
  const hours = Math.floor(minuteOfDay / 60);
  const minutes = minuteOfDay % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Parses an `<input type="time">` value back into minutes.
 *
 * Returns `null` rather than a guess for anything malformed, so the caller
 * reports a validation error instead of persisting a wrong opening time. A
 * browser will normally supply a well-formed value, but the field is still a
 * string arriving over the wire.
 */
export function fromTimeInputValue(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours > 23 || minutes > 59) return null;

  return hours * 60 + minutes;
}
