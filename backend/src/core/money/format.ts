import type { Cents, UsdcUnits } from './money';

// Formatting is for the edge only (CLI output, spend report). Integer arithmetic throughout:
// no division that can leave a fraction, no toFixed.

function splitUnits(value: number, unitsPerWhole: number, decimals: number): string {
  const fraction = value % unitsPerWhole;
  const whole = (value - fraction) / unitsPerWhole;
  return `${whole}.${String(fraction).padStart(decimals, '0')}`;
}

/** 58500 -> "€585.00" */
export function formatEur(amount: Cents): string {
  return `€${splitUnits(amount, 100, 2)}`;
}

/** 585_000_000 -> "585.00 USDC". Shows cents precision; sub-cent units are shown in full. */
export function formatUsdc(amount: UsdcUnits): string {
  const full = splitUnits(amount, 1_000_000, 6);
  const trimmed = full.endsWith('0000') ? full.slice(0, -4) : full;
  return `${trimmed} USDC`;
}
