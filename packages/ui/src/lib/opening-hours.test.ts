import { describe, expect, test } from "bun:test";
import {
  DAY_LABELS,
  STATUS_LABELS,
  formatDayHours,
  formatDayHoursLabel,
  formatTimeOfDay,
  fromTimeInputValue,
  toTimeInputValue,
  type DayHours,
} from "./opening-hours";

function day(overrides: Partial<DayHours> = {}): DayHours {
  return {
    dayOfWeek: "MONDAY",
    isClosed: false,
    opensAt: 540,
    closesAt: 1020,
    isOvernight: false,
    ...overrides,
  };
}

describe("formatTimeOfDay", () => {
  test("renders a 12-hour locale with meridiem", () => {
    expect(formatTimeOfDay(540, "en-US")).toBe("09:00 AM");
    expect(formatTimeOfDay(1020, "en-US")).toBe("05:00 PM");
  });

  test("renders a 24-hour locale without one", () => {
    expect(formatTimeOfDay(1020, "en-GB")).toBe("17:00");
  });

  /**
   * The bug this guards against: formatting without pinning UTC would apply the
   * *viewer's* offset to a wall-clock time and move a restaurant's posted
   * opening hour by however far away the reader happens to be.
   */
  test("midnight and the last minute of the day are not shifted", () => {
    expect(formatTimeOfDay(0, "en-GB")).toBe("00:00");
    expect(formatTimeOfDay(1439, "en-GB")).toBe("23:59");
  });

  test("a half-hour opening time keeps its minutes", () => {
    expect(formatTimeOfDay(750, "en-GB")).toBe("12:30");
  });
});

describe("formatDayHours", () => {
  test("renders an ordinary range", () => {
    expect(formatDayHours(day(), "en-GB")).toBe("09:00 – 17:00");
  });

  test("renders a closed day as a word, not an empty range", () => {
    expect(formatDayHours(day({ isClosed: true, opensAt: null, closesAt: null }))).toBe("Closed");
  });

  test("renders an overnight range as written rather than reordering it", () => {
    expect(
      formatDayHours(day({ opensAt: 1320, closesAt: 120, isOvernight: true }), "en-GB"),
    ).toBe("22:00 – 02:00");
  });
});

describe("formatDayHoursLabel", () => {
  /**
   * An en dash is read inconsistently by screen readers — sometimes "to",
   * sometimes nothing — so the spoken form spells the relationship out.
   */
  test("spells the range out for assistive technology", () => {
    expect(formatDayHoursLabel(day(), "en-GB")).toBe("Monday: 09:00 to 17:00");
  });

  test("says a closed day is closed", () => {
    expect(
      formatDayHoursLabel(day({ dayOfWeek: "SUNDAY", isClosed: true, opensAt: null, closesAt: null })),
    ).toBe("Sunday: closed");
  });

  /**
   * Without this, "10:00 PM to 2:00 AM" sounds like a data-entry mistake rather
   * than a late-night shift.
   */
  test("says out loud that an overnight period ends the next day", () => {
    expect(
      formatDayHoursLabel(
        day({ dayOfWeek: "FRIDAY", opensAt: 1320, closesAt: 120, isOvernight: true }),
        "en-GB",
      ),
    ).toBe("Friday: 22:00 to 02:00 the next day");
  });
});

describe("labels", () => {
  test("every day has a readable name", () => {
    expect(Object.values(DAY_LABELS)).toHaveLength(7);
    expect(DAY_LABELS.WEDNESDAY).toBe("Wednesday");
  });

  /** Status must carry meaning as text, never as colour alone — WCAG 1.4.1. */
  test("every status has text, including the unknown case", () => {
    expect(STATUS_LABELS.open).toBe("Open now");
    expect(STATUS_LABELS.closed).toBe("Closed now");
    expect(STATUS_LABELS.unknown).toBe("Hours not available");
  });
});

describe("time input round-trip", () => {
  test("minutes convert to the value an input expects", () => {
    expect(toTimeInputValue(0)).toBe("00:00");
    expect(toTimeInputValue(540)).toBe("09:00");
    expect(toTimeInputValue(1439)).toBe("23:59");
  });

  test("parses a well-formed value", () => {
    expect(fromTimeInputValue("09:00")).toBe(540);
    expect(fromTimeInputValue("00:00")).toBe(0);
    expect(fromTimeInputValue("23:59")).toBe(1439);
  });

  test("round-trips every value it produces", () => {
    for (const minute of [0, 1, 540, 750, 1319, 1439]) {
      expect(fromTimeInputValue(toTimeInputValue(minute))).toBe(minute);
    }
  });

  /** A guess here would persist the wrong opening time, silently. */
  test.each([
    ["empty", ""],
    ["a bare hour", "9"],
    ["single-digit hour", "9:00"],
    ["an impossible hour", "24:00"],
    ["an impossible minute", "09:60"],
    ["letters", "morning"],
    ["seconds", "09:00:00"],
  ])("rejects %s", (_label, value) => {
    expect(fromTimeInputValue(value)).toBeNull();
  });
});
