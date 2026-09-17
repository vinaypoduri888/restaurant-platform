/**
 * Money formatting, shared by the public menu and the admin console.
 *
 * The API never sends a decimal — a JSON number is an IEEE-754 double, so
 * `12.10` cannot survive a round trip exactly. It sends an exact integer in the
 * currency's minor unit plus the exponent needed to interpret it, and this is
 * the single place that turns those three fields into something a person reads.
 */

export interface Money {
  /** Exact amount in the currency's smallest unit — cents, paise, yen. */
  amountMinor: number;
  /** ISO 4217 alphabetic code, e.g. `USD`. */
  currency: string;
  /** Decimal places: `amountMinor / 10 ** minorUnits` is the major-unit value. */
  minorUnits: number;
}

/**
 * Converts to major units without floating-point drift in the divisor.
 *
 * `10 ** minorUnits` is exact for every real currency exponent (0, 2, 3), so
 * the only imprecision possible is the final division — which is what a
 * currency formatter expects to receive anyway.
 */
function toMajorUnits({ amountMinor, minorUnits }: Money): number {
  return amountMinor / 10 ** minorUnits;
}

/**
 * The visible price, e.g. `$12.50`, `₹280.50`, `¥1,200`.
 *
 * `minorUnits` comes from the API rather than being assumed, so a JPY price
 * renders as ¥1,200 rather than ¥12.00 — a hundredfold error that a hard-coded
 * two decimal places would produce silently.
 *
 * Falls back to `CODE 12.50` for a currency the runtime does not recognise,
 * which is still correct and readable, rather than throwing inside a render.
 */
export function formatMoney(money: Money, locale?: string): string {
  const value = toMajorUnits(money);

  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: money.currency,
      minimumFractionDigits: money.minorUnits,
      maximumFractionDigits: money.minorUnits,
    }).format(value);
  } catch {
    return `${money.currency} ${value.toFixed(money.minorUnits)}`;
  }
}

/**
 * The spoken price, e.g. `12.50 US dollars`.
 *
 * A currency symbol is a visual shorthand, and screen readers do not announce
 * every one of them reliably — `₹` and `¥` in particular. Pairing the visible
 * symbol with this as an `aria-label` means the price is unambiguous however it
 * is consumed, which is the accessibility requirement for prices rather than a
 * nicety.
 */
export function formatMoneyLabel(money: Money, locale?: string): string {
  const value = toMajorUnits(money);

  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: money.currency,
      currencyDisplay: "name",
      minimumFractionDigits: money.minorUnits,
      maximumFractionDigits: money.minorUnits,
    }).format(value);
  } catch {
    return `${value.toFixed(money.minorUnits)} ${money.currency}`;
  }
}

/**
 * Formats a raw minor-unit integer, for the admin surface.
 *
 * The admin endpoints return `priceMinor` on its own, with the currency living
 * on the restaurant record, so this exists to avoid every caller assembling a
 * `Money` object by hand.
 */
export function formatMinor(
  amountMinor: number,
  currency: string,
  locale?: string,
): string {
  return formatMoney({ amountMinor, currency, minorUnits: minorUnitsFor(currency) }, locale);
}

const minorUnitsCache = new Map<string, number>();

/**
 * The currency's decimal places, from the runtime's own ISO 4217 table.
 *
 * Mirrors the API's `minorUnitsFor`; the two must agree, which they do because
 * both read `Intl` rather than a hand-maintained list. Unknown codes fall back
 * to 2, the overwhelmingly common case.
 */
export function minorUnitsFor(currency: string): number {
  const cached = minorUnitsCache.get(currency);
  if (cached !== undefined) return cached;

  let digits = 2;
  try {
    digits =
      new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
        .maximumFractionDigits ?? 2;
  } catch {
    digits = 2;
  }

  minorUnitsCache.set(currency, digits);
  return digits;
}

/**
 * Parses a price a person typed ("12.50") into exact minor units (1250).
 *
 * Deliberately string-based rather than `Math.round(parseFloat(x) * 100)`:
 * `parseFloat("12.10") * 100` is `1209.9999999999998`, and rounding that is a
 * coin flip on the boundary cases. Splitting on the decimal point and padding
 * the fraction is exact for every input a form can produce.
 *
 * Returns `null` for anything that is not a plain non-negative decimal, so the
 * caller reports a validation error rather than persisting a guess.
 */
export function parseMoneyInput(input: string, minorUnits: number): number | null {
  const trimmed = input.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;

  const [whole = "0", fraction = ""] = trimmed.split(".");

  // More decimal places than the currency has is a real mistake, not a
  // rounding opportunity — "12.505" in USD has no correct interpretation.
  if (fraction.length > minorUnits) return null;

  const padded = fraction.padEnd(minorUnits, "0");
  const combined = `${whole}${padded}`;

  const amount = Number(combined);
  return Number.isSafeInteger(amount) ? amount : null;
}

/**
 * Renders minor units back into a plain editable string ("1250" → "12.50"),
 * for populating an edit form. The inverse of `parseMoneyInput`.
 */
export function toMoneyInput(amountMinor: number, minorUnits: number): string {
  if (minorUnits === 0) return String(amountMinor);

  const negative = amountMinor < 0;
  const digits = String(Math.abs(amountMinor)).padStart(minorUnits + 1, "0");
  const whole = digits.slice(0, digits.length - minorUnits);
  const fraction = digits.slice(digits.length - minorUnits);

  return `${negative ? "-" : ""}${whole}.${fraction}`;
}
