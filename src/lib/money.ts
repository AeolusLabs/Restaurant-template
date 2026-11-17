// Money is an integer in the minor unit (kobo). No floats in arithmetic.

export function assertMinor(n: number): void {
  if (!Number.isSafeInteger(n)) {
    throw new RangeError(`Money amount must be a safe integer in the minor unit, got ${n}`);
  }
}

function toSafeNumber(n: bigint): number {
  if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("Money result exceeds the safe integer range");
  }
  return Number(n);
}

/** amount * bps / 10000, rounded half up (half away from zero for negatives). */
export function applyBps(amountMinor: number, bps: number): number {
  assertMinor(amountMinor);
  assertMinor(bps);
  const negative = amountMinor < 0;
  const abs = BigInt(Math.abs(amountMinor));
  const out = (abs * BigInt(bps) + 5000n) / 10000n;
  return toSafeNumber(negative ? -out : out);
}

/** The tax or charge portion contained in a price that already includes it. */
export function extractInclusiveBps(grossMinor: number, bps: number): number {
  assertMinor(grossMinor);
  assertMinor(bps);
  const divisor = 10000n + BigInt(bps);
  const gross = BigInt(grossMinor);
  const net = (gross * 10000n * 2n + divisor) / (2n * divisor);
  return toSafeNumber(gross - net);
}

export type MoneyFormat = { currency: string; exponent: number; locale: string };

/** Formats from an exact decimal string, so large amounts keep every digit. */
export function formatMoney(amountMinor: number, fmt: MoneyFormat): string {
  assertMinor(amountMinor);
  const negative = amountMinor < 0;
  const digits = String(Math.abs(amountMinor)).padStart(fmt.exponent + 1, "0");
  const whole = digits.slice(0, digits.length - fmt.exponent);
  const frac = fmt.exponent > 0 ? `.${digits.slice(digits.length - fmt.exponent)}` : "";
  const decimal = `${negative ? "-" : ""}${whole}${frac}`;
  return new Intl.NumberFormat(fmt.locale, {
    style: "currency",
    currency: fmt.currency,
    minimumFractionDigits: fmt.exponent,
    maximumFractionDigits: fmt.exponent,
  }).format(decimal as unknown as number);
}

/**
 * Reads an amount a person typed ("3500", "3,500.50") into the minor unit, exactly. Returns null for anything
 * that is not a plain non-negative amount with at most `exponent` decimals, or too large to hold exactly.
 * It never rounds: "3500.555" is refused, not turned into 3500.56.
 */
export function parseMoneyInput(input: string, exponent: number): number | null {
  const m = /^(\d+|\d{1,3}(?:,\d{3})+)?(?:\.(\d+))?$/.exec(input.trim());
  if (!m || (m[1] === undefined && m[2] === undefined)) return null;
  const whole = (m[1] ?? "0").replaceAll(",", "");
  const frac = m[2] ?? "";
  if (frac.length > exponent) return null;
  const minor = BigInt(whole + frac.padEnd(exponent, "0"));
  return minor > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(minor);
}

/** The minor unit written as a plain editable amount: 350050 becomes "3500.50". */
export function moneyInputValue(amountMinor: number, exponent: number): string {
  assertMinor(amountMinor);
  const digits = String(amountMinor).padStart(exponent + 1, "0");
  return exponent === 0 ? digits : `${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
}
