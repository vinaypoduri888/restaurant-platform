import { describe, expect, test } from "bun:test";
import { minorUnitsFor, toMoney } from "./money.ts";

describe("minorUnitsFor", () => {
  test("returns two places for the common case", () => {
    expect(minorUnitsFor("USD")).toBe(2);
    expect(minorUnitsFor("EUR")).toBe(2);
    expect(minorUnitsFor("INR")).toBe(2);
  });

  /**
   * The reason this function exists at all. Hard-coding 2 would render a
   * ¥1200 dish as ¥12.00 — a hundredfold pricing error, in production, on a
   * customer-facing menu.
   */
  test("returns zero places for currencies with no minor unit", () => {
    expect(minorUnitsFor("JPY")).toBe(0);
  });

  test("returns three places for currencies that have them", () => {
    expect(minorUnitsFor("KWD")).toBe(3);
  });

  /**
   * ISO 4217 changes over time and the database may already hold a code this
   * runtime does not know. Falling back beats failing a menu read.
   */
  test("falls back to two places for an unknown code", () => {
    expect(minorUnitsFor("ZZZ")).toBe(2);
  });
});

describe("toMoney", () => {
  test("keeps the amount exact and describes how to interpret it", () => {
    expect(toMoney(1250, "USD")).toEqual({ amountMinor: 1250, currency: "USD", minorUnits: 2 });
  });

  /**
   * The whole point of integer minor units: this value has no exact binary
   * floating-point representation, so it must never be transported as one.
   */
  test("a price that a float cannot hold exactly survives intact", () => {
    const money = toMoney(1010, "USD");

    expect(money.amountMinor).toBe(1010);
    expect(Number.isInteger(money.amountMinor)).toBe(true);
    // 10.10 reconstructed by the client, from an exact integer.
    expect(money.amountMinor / 10 ** money.minorUnits).toBeCloseTo(10.1, 10);
  });

  test("zero is a valid price", () => {
    expect(toMoney(0, "USD").amountMinor).toBe(0);
  });
});
