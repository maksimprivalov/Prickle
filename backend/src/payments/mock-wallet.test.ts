import { usdcUnits } from '@core/money';
import { describe, expect, it } from 'vitest';
import { createMockWallet } from './mock-wallet';

const USDC_600 = usdcUnits(600_000_000);
const USDC_585 = usdcUnits(585_000_000);

describe('mock wallet', () => {
  it('moves the amount and returns deterministic signatures', async () => {
    const wallet = createMockWallet(USDC_600);
    expect(
      await wallet.transfer({ storeId: 'b', amount: USDC_585, reference: 's1:b-tv55' }),
    ).toEqual({ ok: true, signature: 'mock-1' });
    expect(await wallet.balance()).toBe(15_000_000);
    expect(wallet.transfers()).toEqual([
      { storeId: 'b', amount: USDC_585, reference: 's1:b-tv55', signature: 'mock-1' },
    ]);
  });

  it('refuses a transfer above the balance and moves nothing', async () => {
    const wallet = createMockWallet(USDC_600);
    const result = await wallet.transfer({
      storeId: 'd',
      amount: usdcUnits(648_000_000),
      reference: 's1:d-tv55',
    });
    expect(result).toMatchObject({ ok: false });
    expect(await wallet.balance()).toBe(USDC_600);
    expect(wallet.transfers()).toEqual([]);
  });

  it('allows a transfer of exactly the whole balance', async () => {
    const wallet = createMockWallet(USDC_600);
    const result = await wallet.transfer({ storeId: 'b', amount: USDC_600, reference: 'r' });
    expect(result.ok).toBe(true);
    expect(await wallet.balance()).toBe(0);
  });

  it('never pays twice for the same reference', async () => {
    const wallet = createMockWallet(USDC_600);
    const request = {
      storeId: 'b',
      amount: usdcUnits(100_000_000),
      reference: 's1:b-tv55',
    } as const;
    const first = await wallet.transfer(request);
    const retry = await wallet.transfer(request);
    expect(retry).toEqual(first);
    expect(await wallet.balance()).toBe(500_000_000);
    expect(wallet.transfers()).toHaveLength(1);
  });
});
