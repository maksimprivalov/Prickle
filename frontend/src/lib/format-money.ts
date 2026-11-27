// The only place money becomes a string. Integers in, strings out: the value is split into
// whole and fractional parts by integer division, never divided as a float.

export const Currency = { Eur: 'EUR', Usdc: 'USDC' } as const;
export type Currency = (typeof Currency)[keyof typeof Currency];

const CENTS_PER_EURO = 100;
const USDC_UNITS_PER_TOKEN = 1_000_000;

const wholeFormat = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });

function assertInteger(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`Money must be a non-negative safe integer, got ${value}`);
  }
}

/** 58500 → "585.00" */
export function formatCents(cents: number): string {
  assertInteger(cents);
  const whole = Math.trunc(cents / CENTS_PER_EURO);
  const fraction = cents % CENTS_PER_EURO;
  return `${wholeFormat.format(whole)}.${String(fraction).padStart(2, '0')}`;
}

/** 585_000_000 → "585", 585_500_000 → "585.50", 1 → "0.000001" (up to six decimals, at least two). */
export function formatUsdc(units: number): string {
  assertInteger(units);
  const whole = Math.trunc(units / USDC_UNITS_PER_TOKEN);
  const fraction = units % USDC_UNITS_PER_TOKEN;
  const head = wholeFormat.format(whole);
  if (fraction === 0) return head;
  const digits = String(fraction).padStart(6, '0').replace(/0+$/, '').padEnd(2, '0');
  return `${head}.${digits}`;
}

/** "585.00 EUR" / "585 test USDC" */
export function formatMoney(value: number, currency: Currency): string {
  return currency === Currency.Eur ? `${formatCents(value)} EUR` : `${formatUsdc(value)} test USDC`;
}
