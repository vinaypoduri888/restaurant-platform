import { describe, expect, test } from "bun:test";
import {
  formatMinor,
  formatMoney,
  formatMoneyLabel,
  minorUnitsFor,
  parseMoneyInput,
  toMoneyInput,
} from "./money";

describe("formatMoney", () => {
  test("renders the common two-decimal case", () => {
    expect(formatMoney({ amountMinor: 1250, currency: "USD", minorUnits: 2 }, "en-US")).toBe(
      "$12.50",
    );
  });

  /**
   * The reason `minorUnits` travels with the price. Assuming two decimal places
   * would render ¥1,200 as ¥12.00 — a hundredfold error on a live menu.
   */
  test("honours a currency with no minor unit", () => {
    const formatted = formatMoney({ amountMinor: 1200, currency: "JPY", minorUnits: 0 }, "en-US");

    expect(formatted).toContain("1,200");
    expect(formatted).not.toContain("12.00");
  });

  test("honours a currency with three decimal places", () => {
    expect(formatMoney({ amountMinor: 1250, currency: "KWD", minorUnits: 3 }, "en-US")).toContain(
      "1.250",
    );
  });

  test("keeps trailing zeros rather than dropping them", () => {
    expect(formatMoney({ amountMinor: 1000, currency: "USD", minorUnits: 2 }, "en-US")).toBe(
      "$10.00",
    );
  });

  test("a free item formats as zero, not as blank", () => {
    expect(formatMoney({ amountMinor: 0, currency: "USD", minorUnits: 2 }, "en-US")).toBe("$0.00");
  });

  /** A menu must render even if the database holds a code this runtime lacks. */
  test("falls back readably for an unknown currency instead of throwing", () => {
    expect(formatMoney({ amountMinor: 1250, currency: "ZZZ", minorUnits: 2 }, "en-US")).toContain(
      "12.50",
    );
  });
});

describe("formatMoneyLabel", () => {
  /**
   * Screen readers do not reliably announce every currency symbol, so the
   * spoken form is generated explicitly rather than left to chance.
   */
  test("spells the currency out for assistive technology", () => {
    expect(formatMoneyLabel({ amountMinor: 1250, currency: "USD", minorUnits: 2 }, "en-US")).toBe(
      "12.50 US dollars",
    );
  });

  test("falls back to the code for an unknown currency", () => {
    expect(formatMoneyLabel({ amountMinor: 1250, currency: "ZZZ", minorUnits: 2 }, "en-US")).toBe(
      "12.50 ZZZ",
    );
  });
});

describe("minorUnitsFor", () => {
  test.each([
    ["USD", 2],
    ["INR", 2],
    ["JPY", 0],
    ["KWD", 3],
    ["ZZZ", 2],
  ])("%s has %i decimal places", (currency, expected) => {
    expect(minorUnitsFor(currency)).toBe(expected);
  });
});

describe("formatMinor", () => {
  test("derives the exponent when the caller only has the code", () => {
    expect(formatMinor(1250, "USD", "en-US")).toBe("$12.50");
    expect(formatMinor(1200, "JPY", "en-US")).toContain("1,200");
  });
});

describe("parseMoneyInput", () => {
  test("converts a typed price to exact minor units", () => {
    expect(parseMoneyInput("12.50", 2)).toBe(1250);
    expect(parseMoneyInput("12", 2)).toBe(1200);
    expect(parseMoneyInput("0", 2)).toBe(0);
  });

  /**
   * The bug this function exists to avoid: `parseFloat("12.10") * 100` is
   * 1209.9999999999998, so rounding decides the price. String arithmetic does
   * not have that failure mode.
   */
  test("is exact for the value floating point cannot represent", () => {
    expect(parseMoneyInput("12.10", 2)).toBe(1210);
    expect(parseMoneyInput("0.07", 2)).toBe(7);
    expect(parseMoneyInput("1.005", 3)).toBe(1005);
  });

  test("handles a zero-decimal currency", () => {
    expect(parseMoneyInput("1200", 0)).toBe(1200);
  });

  test.each([
    ["empty", ""],
    ["letters", "abc"],
    ["a currency symbol", "$12.50"],
    ["a thousands separator", "1,200"],
    ["negative", "-5"],
    ["a bare decimal point", "."],
    ["scientific notation", "1e3"],
  ])("rejects %s", (_label, input) => {
    expect(parseMoneyInput(input, 2)).toBeNull();
  });

  /** "12.505" in USD has no correct interpretation, so it is refused. */
  test("rejects more decimal places than the currency has", () => {
    expect(parseMoneyInput("12.505", 2)).toBeNull();
    expect(parseMoneyInput("12.5", 0)).toBeNull();
  });
});

describe("toMoneyInput", () => {
  test("is the inverse of parseMoneyInput", () => {
    expect(toMoneyInput(1250, 2)).toBe("12.50");
    expect(toMoneyInput(7, 2)).toBe("0.07");
    expect(toMoneyInput(0, 2)).toBe("0.00");
    expect(toMoneyInput(1200, 0)).toBe("1200");
  });

  test("round-trips every value it produces", () => {
    for (const amount of [0, 5, 99, 100, 1250, 99999999]) {
      expect(parseMoneyInput(toMoneyInput(amount, 2), 2)).toBe(amount);
    }
  });
});
