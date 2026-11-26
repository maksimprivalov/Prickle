import { z } from 'zod';
import { Cents, cents } from '@core/money';
import { StoreId } from '@core/offers';
import { StoreError } from './store-client';

// Each store writes money its own way; this turns every one of them into integer Cents.
// String parsing only: no parseFloat, no rounding. Anything unexpected is a StoreError.

const DECIMAL_EUROS = /^(\d+)[.,](\d{2})$/;

/** "585.00" or "599,00" -> 58500 / 59900. Exactly two decimals, or it is not a price. */
export function decimalEurosToCents(text: string): Cents {
  const match = DECIMAL_EUROS.exec(text.trim());
  if (!match?.[1] || !match[2]) throw new StoreError(`not a euro amount: "${text}"`);
  return cents(Number(match[1]) * 100 + Number(match[2]));
}

const StoreDMoney = z.object({ amount: Cents, currency: z.literal('EUR') });

export function parseStoreMoney(storeId: StoreId, raw: unknown): Cents {
  switch (storeId) {
    case StoreId.A: {
      const parsed = Cents.safeParse(raw);
      if (!parsed.success) throw new StoreError(`store A: not an amount in cents: ${String(raw)}`);
      return parsed.data;
    }
    case StoreId.B:
      if (typeof raw !== 'string')
        throw new StoreError(`store B: expected "585.00", got ${String(raw)}`);
      return decimalEurosToCents(raw);
    case StoreId.C:
      if (typeof raw !== 'string' || !raw.startsWith('€')) {
        throw new StoreError(`store C: expected "€599,00", got ${String(raw)}`);
      }
      return decimalEurosToCents(raw.slice(1));
    case StoreId.D: {
      const parsed = StoreDMoney.safeParse(raw);
      if (!parsed.success)
        throw new StoreError(`store D: not a price object: ${JSON.stringify(raw)}`);
      return parsed.data.amount;
    }
    case StoreId.E:
      if (typeof raw !== 'string' || !raw.startsWith('EUR ')) {
        throw new StoreError(`store E: expected "EUR 559.00", got ${String(raw)}`);
      }
      return decimalEurosToCents(raw.slice(4));
  }
}
