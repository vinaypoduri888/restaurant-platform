import { describe, expect, test } from "bun:test";
import { isValidTimeZone, type DayOfWeek } from "@repo/validation/operating-hours";
import {
  formatMinuteOfDay,
  isOvernight,
  previousDay,
  resolveOpenStatus,
  toLocalMoment,
  type DayHours,
} from "./opening-hours.ts";

/**
 * Every test supplies an explicit instant. Nothing here reads the clock, so a
 * test that passes today passes in July, in a different container time zone,
 * and on the Sunday the clocks change.
 */

const at = (hour: number, minute = 0) => hour * 60 + minute;

function open(dayOfWeek: DayOfWeek, opensAt: number, closesAt: number): DayHours {
  return { dayOfWeek, isClosed: false, opensAt, closesAt };
}

function closed(dayOfWeek: DayOfWeek): DayHours {
  return { dayOfWeek, isClosed: true, opensAt: null, closesAt: null };
}

/** A full week, closed unless overridden. */
function week(...overrides: DayHours[]): DayHours[] {
  const base: DayHours[] = [
    closed("MONDAY"),
    closed("TUESDAY"),
    closed("WEDNESDAY"),
    closed("THURSDAY"),
    closed("FRIDAY"),
    closed("SATURDAY"),
    closed("SUNDAY"),
  ];

  return base.map((day) => overrides.find((o) => o.dayOfWeek === day.dayOfWeek) ?? day);
}

describe("toLocalMoment", () => {
  /** 2026-08-31 is a Monday. 10:00 UTC is 15:30 in India (UTC+5:30). */
  test("converts an instant into the restaurant's local weekday and time", () => {
    expect(toLocalMoment(new Date("2026-08-31T10:00:00Z"), "Asia/Kolkata")).toEqual({
      dayOfWeek: "MONDAY",
      minuteOfDay: at(15, 30),
    });
  });

  /**
   * The conversion can move the *day*, not only the time — 20:00 UTC on Monday
   * is already Tuesday in Kolkata. Getting this wrong shows the wrong day's
   * hours.
   */
  test("crossing midnight locally also moves the weekday", () => {
    expect(toLocalMoment(new Date("2026-08-31T20:00:00Z"), "Asia/Kolkata")).toEqual({
      dayOfWeek: "TUESDAY",
      minuteOfDay: at(1, 30),
    });
  });

  test("a zone behind UTC can move the weekday backwards", () => {
    // Tuesday 02:00 UTC is still Monday 22:00 in New York.
    expect(toLocalMoment(new Date("2026-09-01T02:00:00Z"), "America/New_York")).toEqual({
      dayOfWeek: "MONDAY",
      minuteOfDay: at(22),
    });
  });

  /**
   * The `h24` hour cycle renders midnight as "24", which would give a
   * minute-of-day of 1440 and silently break every comparison.
   */
  test("local midnight is minute 0, never 1440", () => {
    expect(toLocalMoment(new Date("2026-08-31T00:00:00Z"), "UTC").minuteOfDay).toBe(0);
  });

  test("the last minute of the day is 1439", () => {
    expect(toLocalMoment(new Date("2026-08-31T23:59:00Z"), "UTC").minuteOfDay).toBe(1439);
  });

  test("a half-hour offset zone is handled exactly", () => {
    expect(toLocalMoment(new Date("2026-08-31T00:00:00Z"), "Asia/Kolkata").minuteOfDay).toBe(
      at(5, 30),
    );
  });

  /** Nepal is UTC+5:45 — a 45-minute offset, which integer-hour maths misses. */
  test("a 45-minute offset zone is handled exactly", () => {
    expect(toLocalMoment(new Date("2026-08-31T00:00:00Z"), "Asia/Kathmandu").minuteOfDay).toBe(
      at(5, 45),
    );
  });
});

describe("previousDay", () => {
  test("walks backwards through the week", () => {
    expect(previousDay("TUESDAY")).toBe("MONDAY");
    expect(previousDay("SUNDAY")).toBe("SATURDAY");
  });

  test("wraps Monday back to Sunday", () => {
    expect(previousDay("MONDAY")).toBe("SUNDAY");
  });
});

describe("isOvernight", () => {
  test("a period whose close is earlier than its open runs past midnight", () => {
    expect(isOvernight(open("MONDAY", at(22), at(2)))).toBe(true);
  });

  test("an ordinary daytime period does not", () => {
    expect(isOvernight(open("MONDAY", at(9), at(17)))).toBe(false);
  });

  test("a closed day is never overnight", () => {
    expect(isOvernight(closed("MONDAY"))).toBe(false);
  });
});

describe("normal hours", () => {
  const hours = week(open("MONDAY", at(9), at(17)));

  test.each([
    ["mid-morning", "2026-08-31T12:00:00Z", "open"],
    ["before opening", "2026-08-31T08:00:00Z", "closed"],
    ["after closing", "2026-08-31T18:00:00Z", "closed"],
  ] as const)("%s is %s", (_label, instant, expected) => {
    expect(resolveOpenStatus(hours, "UTC", new Date(instant))).toBe(expected);
  });

  /**
   * The documented boundary semantics: the period is half-open,
   * `[opensAt, closesAt)`. Open at the opening minute, closed at the closing
   * minute — which is what "we close at 17:00" means to a person.
   */
  test.each([
    ["one minute before opening", "2026-08-31T08:59:00Z", "closed"],
    ["exactly the opening minute", "2026-08-31T09:00:00Z", "open"],
    ["one minute after opening", "2026-08-31T09:01:00Z", "open"],
    ["one minute before closing", "2026-08-31T16:59:00Z", "open"],
    ["exactly the closing minute", "2026-08-31T17:00:00Z", "closed"],
    ["one minute after closing", "2026-08-31T17:01:00Z", "closed"],
  ] as const)("%s is %s", (_label, instant, expected) => {
    expect(resolveOpenStatus(hours, "UTC", new Date(instant))).toBe(expected);
  });
});

describe("closed days", () => {
  const hours = week(open("MONDAY", at(9), at(17)), closed("TUESDAY"));

  test("a day marked closed is closed even at a time the restaurant usually trades", () => {
    // Tuesday noon — Monday's hours must not leak across.
    expect(resolveOpenStatus(hours, "UTC", new Date("2026-09-01T12:00:00Z"))).toBe("closed");
  });

  test("a day with no entry at all is treated as closed, not open", () => {
    const partial: DayHours[] = [open("MONDAY", at(9), at(17))];
    expect(resolveOpenStatus(partial, "UTC", new Date("2026-09-01T12:00:00Z"))).toBe("closed");
  });
});

describe("missing configuration", () => {
  /**
   * The distinction that matters commercially: a restaurant whose owner has not
   * filled in the form is *not* closed. Reporting "closed" would turn an empty
   * admin field into a customer who walks away.
   */
  test("no configured hours is unknown, not closed", () => {
    expect(resolveOpenStatus([], "UTC", new Date("2026-08-31T12:00:00Z"))).toBe("unknown");
  });
});

describe("overnight hours", () => {
  /** Monday 22:00 → 02:00, then an ordinary Tuesday daytime shift. */
  const hours = week(open("MONDAY", at(22), at(2)), open("TUESDAY", at(10), at(18)));

  test.each([
    ["Monday 21:59, before opening", "2026-08-31T21:59:00Z", "closed"],
    ["Monday 22:00, opening minute", "2026-08-31T22:00:00Z", "open"],
    ["Monday 23:00, evening leg", "2026-08-31T23:00:00Z", "open"],
    ["Tuesday 00:30, past midnight", "2026-09-01T00:30:00Z", "open"],
    ["Tuesday 01:00, still Monday's period", "2026-09-01T01:00:00Z", "open"],
    ["Tuesday 01:59, last minute", "2026-09-01T01:59:00Z", "open"],
    ["Tuesday 02:00, closing minute", "2026-09-01T02:00:00Z", "closed"],
    ["Tuesday 03:00, after closing", "2026-09-01T03:00:00Z", "closed"],
    ["Tuesday 09:00, gap before the day shift", "2026-09-01T09:00:00Z", "closed"],
    ["Tuesday 12:00, day shift", "2026-09-01T12:00:00Z", "open"],
  ] as const)("%s is %s", (_label, instant, expected) => {
    expect(resolveOpenStatus(hours, "UTC", new Date(instant))).toBe(expected);
  });

  /**
   * The week wraps: Sunday night's period spills into Monday morning. Looking
   * back a day must not fall off the start of the array.
   */
  test("a Sunday overnight period continues into Monday morning", () => {
    const sundayNight = week(open("SUNDAY", at(23), at(3)));

    // 2026-09-06 is a Sunday; 2026-09-07 is the Monday after.
    expect(resolveOpenStatus(sundayNight, "UTC", new Date("2026-09-06T23:30:00Z"))).toBe("open");
    expect(resolveOpenStatus(sundayNight, "UTC", new Date("2026-09-07T01:00:00Z"))).toBe("open");
    expect(resolveOpenStatus(sundayNight, "UTC", new Date("2026-09-07T04:00:00Z"))).toBe("closed");
  });

  /**
   * If yesterday was closed, this morning must not be open — the look-back has
   * to check that yesterday actually ran overnight.
   */
  test("an early morning after a closed day is closed", () => {
    const hoursWithClosedMonday = week(closed("MONDAY"), open("TUESDAY", at(10), at(18)));

    expect(
      resolveOpenStatus(hoursWithClosedMonday, "UTC", new Date("2026-09-01T01:00:00Z")),
    ).toBe("closed");
  });

  /** A same-day period yesterday must not spill into this morning either. */
  test("an early morning after an ordinary day is closed", () => {
    const daytimeOnly = week(open("MONDAY", at(9), at(17)));

    expect(resolveOpenStatus(daytimeOnly, "UTC", new Date("2026-09-01T01:00:00Z"))).toBe("closed");
  });
});

describe("timezone conversion", () => {
  const hours = week(open("MONDAY", at(9), at(17)));

  /**
   * The same instant is open or closed depending only on where the restaurant
   * stands. This is the whole reason the zone lives on the restaurant.
   */
  test("one instant gives different answers in different zones", () => {
    const instant = new Date("2026-08-31T10:00:00Z");

    // 15:30 Monday in Kolkata — inside 09:00–17:00.
    expect(resolveOpenStatus(hours, "Asia/Kolkata", instant)).toBe("open");
    // 06:00 Monday in New York — before opening.
    expect(resolveOpenStatus(hours, "America/New_York", instant)).toBe("closed");
    // 10:00 Monday UTC — open.
    expect(resolveOpenStatus(hours, "UTC", instant)).toBe("open");
  });

  test("a zone ahead of UTC can already be on the next local day", () => {
    const tuesdayHours = week(open("TUESDAY", at(1), at(3)));
    // Monday 20:00 UTC is Tuesday 01:30 in Kolkata.
    expect(resolveOpenStatus(tuesdayHours, "Asia/Kolkata", new Date("2026-08-31T20:00:00Z"))).toBe(
      "open",
    );
  });
});

describe("daylight saving", () => {
  const hours = week(
    open("SUNDAY", at(9), at(17)),
    open("MONDAY", at(9), at(17)),
    open("TUESDAY", at(9), at(17)),
    open("WEDNESDAY", at(9), at(17)),
    open("THURSDAY", at(9), at(17)),
    open("FRIDAY", at(9), at(17)),
    open("SATURDAY", at(9), at(17)),
  );

  /**
   * The rule being protected: hours are **local wall-clock** times. 09:00 means
   * nine in the morning in the restaurant's street, in winter and in summer.
   * A stored fixed offset would be an hour wrong for half the year — and would
   * be wrong in opposite directions in March and November.
   */
  test("13:30 UTC is inside opening hours in New York during DST but not outside it", () => {
    // July: EDT, UTC−4, so 13:30Z is 09:30 local — open.
    expect(resolveOpenStatus(hours, "America/New_York", new Date("2026-07-15T13:30:00Z"))).toBe(
      "open",
    );
    // January: EST, UTC−5, so 13:30Z is 08:30 local — still closed.
    expect(resolveOpenStatus(hours, "America/New_York", new Date("2026-01-15T13:30:00Z"))).toBe(
      "closed",
    );
  });

  /**
   * US DST in 2026 starts Sunday 8 March and ends Sunday 1 November. These
   * instants sit deliberately either side of those transitions.
   */
  test.each([
    ["the day before spring forward (EST, UTC-5)", "2026-03-07T14:30:00Z", "open"],
    ["the day before spring forward, an hour earlier", "2026-03-07T13:30:00Z", "closed"],
    ["the day after spring forward (EDT, UTC-4)", "2026-03-09T13:30:00Z", "open"],
    ["mid-summer (EDT)", "2026-07-15T13:30:00Z", "open"],
    ["the day after clocks go back (EST)", "2026-11-02T14:30:00Z", "open"],
    ["the day after clocks go back, an hour earlier", "2026-11-02T13:30:00Z", "closed"],
  ] as const)("%s is %s", (_label, instant, expected) => {
    expect(resolveOpenStatus(hours, "America/New_York", new Date(instant))).toBe(expected);
  });

  /**
   * The spring-forward gap: 02:00–03:00 local never happens on that date. A
   * restaurant open 09:00–17:00 is unaffected, which is the point — the
   * conversion must not throw or produce nonsense on a transition day.
   */
  test("a spring-forward transition day still resolves normally", () => {
    // 2026-03-08 is the transition Sunday in the US.
    expect(resolveOpenStatus(hours, "America/New_York", new Date("2026-03-08T16:00:00Z"))).toBe(
      "open",
    );
  });

  /**
   * The autumn ambiguity: 01:00–02:00 local occurs twice. Again the restaurant
   * is unaffected, but the conversion must remain total.
   */
  test("an autumn fall-back transition day still resolves normally", () => {
    // 2026-11-01 is the transition Sunday in the US.
    expect(resolveOpenStatus(hours, "America/New_York", new Date("2026-11-01T16:00:00Z"))).toBe(
      "open",
    );
  });

  /**
   * The control case. India has never observed daylight saving, so the same
   * wall-clock instant maps identically in January and July — proving the DST
   * results above come from the zone rules and not from something incidental.
   */
  test("a zone without DST behaves identically in winter and summer", () => {
    const winter = resolveOpenStatus(hours, "Asia/Kolkata", new Date("2026-01-15T05:00:00Z"));
    const summer = resolveOpenStatus(hours, "Asia/Kolkata", new Date("2026-07-15T05:00:00Z"));

    // 10:30 local on both dates.
    expect(winter).toBe("open");
    expect(summer).toBe("open");
  });

  /**
   * Europe changes on different dates from the US — late March and late
   * October — so a single hard-coded transition date would fail here.
   */
  test("a European zone uses its own transition dates", () => {
    // 2026-03-29 is when EU clocks go forward. 07:30Z is 08:30 CET on the 28th
    // (closed) but 09:30 CEST on the 30th (open).
    expect(resolveOpenStatus(hours, "Europe/Amsterdam", new Date("2026-03-28T07:30:00Z"))).toBe(
      "closed",
    );
    expect(resolveOpenStatus(hours, "Europe/Amsterdam", new Date("2026-03-30T07:30:00Z"))).toBe(
      "open",
    );
  });

  /**
   * A southern-hemisphere zone runs DST in the opposite half of the year, which
   * catches any assumption that "summer" means June–August.
   */
  test("a southern-hemisphere zone shifts in the opposite season", () => {
    // Sydney is UTC+11 in January (AEDT) and UTC+10 in July (AEST).
    expect(toLocalMoment(new Date("2026-01-15T00:00:00Z"), "Australia/Sydney").minuteOfDay).toBe(
      at(11),
    );
    expect(toLocalMoment(new Date("2026-07-15T00:00:00Z"), "Australia/Sydney").minuteOfDay).toBe(
      at(10),
    );
  });
});

describe("overnight across a DST transition", () => {
  /**
   * The two hard parts of this phase combined: a period that crosses midnight,
   * on a night when the clocks change. The look-back to the previous day must
   * still work when that day had a different UTC offset.
   */
  test("an overnight period spanning the autumn transition still resolves", () => {
    const hours = week(open("SATURDAY", at(22), at(3)), open("SUNDAY", at(12), at(20)));

    // 2026-10-31 is a Saturday; the US transition is early on Sunday 1 Nov.
    // 03:00Z on Sunday is 23:00 Saturday local (EDT) — inside the evening leg.
    expect(resolveOpenStatus(hours, "America/New_York", new Date("2026-11-01T03:00:00Z"))).toBe(
      "open",
    );
    // 06:30Z is 02:30 Sunday local (EDT, before the 02:00 EST switch) — inside
    // the early-morning leg carried over from Saturday.
    expect(resolveOpenStatus(hours, "America/New_York", new Date("2026-11-01T06:30:00Z"))).toBe(
      "open",
    );
    // 09:00Z is 04:00 Sunday local (EST) — after closing, before the day shift.
    expect(resolveOpenStatus(hours, "America/New_York", new Date("2026-11-01T09:00:00Z"))).toBe(
      "closed",
    );
  });
});

describe("time zone validation", () => {
  /**
   * `Intl` alone is not a sufficient check, and that was established by probing
   * it rather than assumed: it accepts `+05:30` and `-08:00` as valid time zone
   * values and resolves them to themselves. A fixed offset cannot express a
   * daylight-saving transition, so accepting one would make a New York
   * restaurant an hour wrong for half the year — silently.
   */
  test.each([
    ["a named zone", "Asia/Kolkata", true],
    ["UTC", "UTC", true],
    ["a three-part name", "America/Argentina/Buenos_Aires", true],
    ["an Etc zone", "Etc/GMT+5", true],
    ["a positive fixed offset", "+05:30", false],
    ["a negative fixed offset", "-08:00", false],
    ["a bare time", "05:30", false],
    ["a made-up zone", "Mars/Olympus_Mons", false],
    ["a legacy POSIX name", "EST5EDT", false],
    ["an empty string", "", false],
    ["a plain city", "Kolkata", false],
  ] as const)("%s -> %s", (_label, zone, expected) => {
    expect(isValidTimeZone(zone)).toBe(expected);
  });

  /** Anything accepted must actually be usable by the conversion. */
  test("every accepted zone can be converted with", () => {
    for (const zone of ["UTC", "Asia/Kolkata", "America/New_York", "Etc/GMT+5"]) {
      expect(isValidTimeZone(zone)).toBe(true);
      expect(() => toLocalMoment(new Date("2026-08-31T10:00:00Z"), zone)).not.toThrow();
    }
  });
});

describe("formatMinuteOfDay", () => {
  test.each([
    [0, "00:00"],
    [60, "01:00"],
    [750, "12:30"],
    [1319, "21:59"],
    [1439, "23:59"],
  ])("%i renders as %s", (minute, expected) => {
    expect(formatMinuteOfDay(minute)).toBe(expected);
  });
});
