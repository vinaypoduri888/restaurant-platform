import { z } from "zod";
import { resourceIdSchema } from "./common.ts";

/**
 * Operating hours and the time zone they are expressed in.
 *
 * Hours are **wall-clock times in the restaurant's own zone**, not instants.
 * "We open at 9" means nine in the morning where the restaurant stands, in
 * winter and in summer alike — which is exactly why the zone is an IANA
 * identifier and not a fixed offset.
 */

/** Monday first, matching the database enum's declaration and sort order. */
export const DAYS_OF_WEEK = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
] as const;

export type DayOfWeek = (typeof DAYS_OF_WEEK)[number];

export const dayOfWeekSchema = z.enum(DAYS_OF_WEEK);

/**
 * Minutes since local midnight: `0` is 00:00 and `1439` is 23:59.
 *
 * `1440` is deliberately rejected. Midnight belongs to the following day, so
 * allowing it would give two spellings of the same instant and make the
 * overnight comparison ambiguous.
 */
export const minuteOfDaySchema = z
  .number()
  .int("Time must be a whole number of minutes past midnight")
  .min(0, "Time cannot be before 00:00")
  .max(1439, "Time cannot be after 23:59");

/**
 * An IANA time zone identifier, validated by asking the runtime.
 *
 * `Intl` is the same engine that will later perform the conversion, so a value
 * that passes here is guaranteed usable by the calculation — which a regular
 * expression over a hard-coded list could not promise. It also rejects fixed
 * offsets such as `+05:30` for free, since those are not zone identifiers.
 *
 * The zone database changes as governments change their rules, so an allow-list
 * frozen into this file would be wrong within a year.
 */
export const timeZoneSchema = z
  .string()
  .trim()
  .min(1, "Time zone is required")
  .max(64)
  .refine(isValidTimeZone, {
    message: "Enter a valid IANA time zone, for example Asia/Kolkata or Europe/Amsterdam",
  });

/**
 * A named zone: letters first, then letters, digits, `_`, `+`, `-`, and `/`.
 *
 * This exists because `Intl` alone is **not** a sufficient check, which was
 * established by probing it rather than assumed: ECMA-402 accepts offset
 * strings such as `+05:30` and `-08:00` as valid `timeZone` values and resolves
 * them to themselves. Those are precisely what must be refused — a fixed offset
 * cannot express a daylight-saving transition, so a restaurant stored as
 * `-05:00` would report the wrong hours for half the year, and would do it
 * silently.
 *
 * Requiring a leading letter rejects every offset form while still admitting
 * `UTC`, `Asia/Kolkata`, `America/Argentina/Buenos_Aires`, and `Etc/GMT+5`.
 */
const NAMED_ZONE_PATTERN = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/;

export function isValidTimeZone(value: string): boolean {
  if (!NAMED_ZONE_PATTERN.test(value)) return false;

  try {
    // The runtime's own zone database — the same one that will later perform
    // the conversion — rejects names it cannot resolve.
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * One day's hours.
 *
 * Two mutually exclusive shapes rather than one shape with magic values:
 * a closed day carries no times at all, and an open day must carry both. The
 * database enforces the same invariant with a CHECK constraint, so a row can
 * never be half-configured whichever path wrote it.
 */
export const dayHoursSchema = z
  .object({
    dayOfWeek: dayOfWeekSchema,
    isClosed: z.boolean(),
    opensAt: minuteOfDaySchema.nullish(),
    closesAt: minuteOfDaySchema.nullish(),
  })
  .superRefine((value, ctx) => {
    if (value.isClosed) {
      if (value.opensAt != null || value.closesAt != null) {
        ctx.addIssue({
          code: "custom",
          path: ["isClosed"],
          message: "A closed day must not have opening or closing times",
        });
      }
      return;
    }

    if (value.opensAt == null) {
      ctx.addIssue({ code: "custom", path: ["opensAt"], message: "Opening time is required" });
    }
    if (value.closesAt == null) {
      ctx.addIssue({ code: "custom", path: ["closesAt"], message: "Closing time is required" });
    }

    /*
     * Equal times are ambiguous — a zero-length period, or a full 24 hours?
     * "Open 24 hours" is not a product requirement, so rather than pick an
     * interpretation the value is refused and the owner asked to be explicit.
     *
     * Note what is NOT rejected: `closesAt < opensAt`. That is the overnight
     * case (22:00 → 02:00) and is a first-class, supported shape.
     */
    if (value.opensAt != null && value.closesAt != null && value.opensAt === value.closesAt) {
      ctx.addIssue({
        code: "custom",
        path: ["closesAt"],
        message: "Opening and closing times must differ",
      });
    }
  });

/**
 * The whole week, replaced in one request.
 *
 * A schedule is edited as a unit, and requiring all seven days makes the
 * written state total: there is no way to leave a day undefined and later
 * wonder whether it means "closed" or "not set up yet". It also makes the write
 * idempotent, which a per-day patch sequence is not.
 */
export const replaceOperatingHoursSchema = z
  .object({
    days: z.array(dayHoursSchema).length(7, "All seven days must be supplied"),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();

    for (const [index, day] of value.days.entries()) {
      if (seen.has(day.dayOfWeek)) {
        ctx.addIssue({
          code: "custom",
          path: ["days", index, "dayOfWeek"],
          message: `${day.dayOfWeek} appears more than once`,
        });
      }
      seen.add(day.dayOfWeek);
    }

    for (const day of DAYS_OF_WEEK) {
      if (!seen.has(day)) {
        ctx.addIssue({ code: "custom", path: ["days"], message: `${day} is missing` });
      }
    }
  });

export const restaurantHoursParamSchema = z.object({
  restaurantId: resourceIdSchema,
});

export type DayHoursInput = z.infer<typeof dayHoursSchema>;
export type ReplaceOperatingHoursInput = z.infer<typeof replaceOperatingHoursSchema>;
export type RestaurantHoursParam = z.infer<typeof restaurantHoursParamSchema>;
