import { usdcUnits, type Cents, type UsdcUnits } from './money';

/**
 * The one exchange rate in Prickle: 1 EUR = 1 test USDC, stated in the spend report.
 * USDC has 6 decimals and a euro has 2, so one cent is 10 000 base units.
 */
export const USDC_UNITS_PER_CENT = 10_000;
export const EUR_TO_TEST_USDC_RATE_LABEL = '1 EUR = 1 test USDC';

export function toUsdcUnits(amount: Cents): UsdcUnits {
  return usdcUnits(amount * USDC_UNITS_PER_CENT);
}
