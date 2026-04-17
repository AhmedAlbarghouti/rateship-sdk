/**
 * Money helpers. All adapters convert provider-reported amounts to integer
 * cents so `price_cents` is exact across providers and JSON-safe.
 *
 * We go through strings (not `Math.round(x * 100)`) because binary
 * floating-point rounding flips values like `12.345 * 100 = 1234.4999...`
 * the wrong way.
 */

/**
 * Convert a decimal-string amount (e.g. "8.40" or "12.345") to integer cents.
 * Rounds half-up based on the third decimal digit.
 */
export function amountToCents(amount: string): number {
  const normalized = amount.trim();
  const sign = normalized.startsWith("-") ? -1 : 1;
  const unsigned = normalized.replace(/^-/, "");
  const [intPart = "0", fracPart = ""] = unsigned.split(".");
  const padded = (fracPart + "000").slice(0, 3);
  const wholeCents =
    parseInt(intPart, 10) * 100 + parseInt(padded.slice(0, 2), 10);
  const halfDigit = parseInt(padded.slice(2, 3), 10);
  return sign * (halfDigit >= 5 ? wholeCents + 1 : wholeCents);
}

/**
 * Convert a number amount (e.g. ShipEngine's `shipping_amount.amount`) to
 * integer cents. Routes through the string path so binary FP can't bite us.
 */
export function floatToCents(amount: number): number {
  return amountToCents(amount.toFixed(3));
}
