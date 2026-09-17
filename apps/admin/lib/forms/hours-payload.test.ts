import { describe, expect, test } from "bun:test";
import { replaceOperatingHoursSchema } from "@repo/validation/operating-hours";
import { buildWeekFromFormData, toHoursFieldErrors } from "./hours-payload";

/**
 * The hours form is the one place a person's typing becomes the integers that
 * decide when a restaurant appears open, so the translation is exercised
 * directly rather than only through the page.
 */

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

/** A complete week of 09:00–17:00, which callers then override. */
function openWeek(overrides: Record<string, string> = {}): FormData {
  const entries: Record<string, string> = {};
  for (const day of [
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
    "SATURDAY",
    "SUNDAY",
  ]) {
    entries[`${day}-opens`] = "09:00";
    entries[`${day}-closes`] = "17:00";
  }
  return form({ ...entries, ...overrides });
}

describe("buildWeekFromFormData", () => {
  test("converts HH:MM into minutes past midnight", () => {
    const { days, fieldErrors } = buildWeekFromFormData(openWeek());

    expect(fieldErrors).toEqual({});
    expect(days[0]).toEqual({
      dayOfWeek: "MONDAY",
      isClosed: false,
      opensAt: 540,
      closesAt: 1020,
    });
  });

  /**
   * The API requires a complete week. Iterating the submitted keys instead of
   * the known days would silently send six on any form that lost one.
   */
  test("always produces all seven days, in order", () => {
    const { days } = buildWeekFromFormData(form({}));

    expect(days).toHaveLength(7);
    expect(days.map((d) => d.dayOfWeek)).toEqual([
      "MONDAY",
      "TUESDAY",
      "WEDNESDAY",
      "THURSDAY",
      "FRIDAY",
      "SATURDAY",
      "SUNDAY",
    ]);
  });

  /** One representation of closed: the flag, and no times at all. */
  test("a closed day carries no times", () => {
    const { days } = buildWeekFromFormData(
      openWeek({ "SUNDAY-closed": "on" }),
    );
    const sunday = days.find((d) => d.dayOfWeek === "SUNDAY");

    expect(sunday).toEqual({ dayOfWeek: "SUNDAY", isClosed: true });
    expect(sunday).not.toHaveProperty("opensAt");
  });

  /**
   * A closed day's time inputs are not rendered, so they submit nothing. That
   * must not be reported as a missing time.
   */
  test("a closed day with no submitted times produces no errors", () => {
    const { fieldErrors } = buildWeekFromFormData(
      form({
        "MONDAY-closed": "on",
        "TUESDAY-closed": "on",
        "WEDNESDAY-closed": "on",
        "THURSDAY-closed": "on",
        "FRIDAY-closed": "on",
        "SATURDAY-closed": "on",
        "SUNDAY-closed": "on",
      }),
    );

    expect(fieldErrors).toEqual({});
  });

  test("an overnight period is passed through unchanged", () => {
    const { days } = buildWeekFromFormData(
      openWeek({ "FRIDAY-opens": "22:00", "FRIDAY-closes": "02:00" }),
    );
    const friday = days.find((d) => d.dayOfWeek === "FRIDAY");

    // Not reordered, not split — the overnight form is preserved for the API.
    expect(friday).toEqual({
      dayOfWeek: "FRIDAY",
      isClosed: false,
      opensAt: 1320,
      closesAt: 120,
    });
  });

  test("an unparseable time is reported against its own field", () => {
    const { fieldErrors } = buildWeekFromFormData(openWeek({ "WEDNESDAY-opens": "" }));

    expect(fieldErrors).toEqual({ "WEDNESDAY-opens": "Enter an opening time" });
  });

  test("both halves of a day can fail independently", () => {
    const { fieldErrors } = buildWeekFromFormData(
      openWeek({ "MONDAY-opens": "nope", "MONDAY-closes": "25:00" }),
    );

    expect(Object.keys(fieldErrors).sort()).toEqual(["MONDAY-closes", "MONDAY-opens"]);
  });

  /** What the editor produces must satisfy the schema the API validates with. */
  test("a normal week passes the shared validation schema", () => {
    const { days } = buildWeekFromFormData(
      openWeek({ "SUNDAY-closed": "on", "FRIDAY-opens": "22:00", "FRIDAY-closes": "02:00" }),
    );

    expect(replaceOperatingHoursSchema.safeParse({ days }).success).toBe(true);
  });

  test("equal opening and closing times are caught by the shared schema", () => {
    const { days } = buildWeekFromFormData(
      openWeek({ "MONDAY-opens": "09:00", "MONDAY-closes": "09:00" }),
    );

    expect(replaceOperatingHoursSchema.safeParse({ days }).success).toBe(false);
  });
});

describe("toHoursFieldErrors", () => {
  /**
   * The schema validates an array and reports `days.4.closesAt`; the form's
   * input is named `FRIDAY-closes`. Without this translation the message would
   * be correct and attached to nothing on screen.
   */
  test("re-keys a positional schema path onto the form's field name", () => {
    const errors = toHoursFieldErrors([
      { path: ["days", 4, "closesAt"], message: "Opening and closing times must differ" },
    ]);

    expect(errors).toEqual({
      "FRIDAY-closes": "Opening and closing times must differ",
    });
  });

  test("maps the opening side too", () => {
    const errors = toHoursFieldErrors([
      { path: ["days", 0, "opensAt"], message: "Opening time is required" },
    ]);

    expect(errors["MONDAY-opens"]).toBe("Opening time is required");
  });

  test("keeps the first message per field rather than the last", () => {
    const errors = toHoursFieldErrors([
      { path: ["days", 0, "opensAt"], message: "first" },
      { path: ["days", 0, "opensAt"], message: "second" },
    ]);

    expect(errors["MONDAY-opens"]).toBe("first");
  });

  /** A whole-array issue has no day to attach to and must not invent one. */
  test("ignores an issue with no day index", () => {
    expect(toHoursFieldErrors([{ path: ["days"], message: "MONDAY is missing" }])).toEqual({});
  });
});
