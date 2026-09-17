/**
 * Money crosses the API boundary as an integer plus the information needed to
 * interpret it, never as a decimal number.
 *
 * A JSON number is an IEEE-754 double, so `12.10` does not survive a round trip
 * exactly. Sending the minor-unit integer keeps the value exact, and sending
 * the currency and its exponent alongside means the client can render it
 * without a hard-coded assumption that every currency has two decimal places.
 */
export interface MoneyView {
  /** Exact amount in the currency's smallest unit — cents, paise, yen. */
  amountMinor: number;
  /** ISO 4217 alphabetic code, e.g. `USD`. */
  currency: string;
  /** Decimal places: `amountMinor / 10 ** minorUnits` is the major-unit value. */
  minorUnits: number;
}

const minorUnitsCache = new Map<string, number>();

/**
 * Not every currency has two decimal places — JPY has none, KWD has three — so
 * assuming 2 would misprice a menu by a factor of a hundred in those markets.
 *
 * `Intl` already carries the ISO 4217 exponent table, which avoids shipping and
 * maintaining a copy of it here. Unknown codes fall back to 2, matching the
 * common case rather than throwing on data that is already persisted.
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

export function toMoney(amountMinor: number, currency: string): MoneyView {
  return { amountMinor, currency, minorUnits: minorUnitsFor(currency) };
}
