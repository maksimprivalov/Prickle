import { WalletKind } from '@core/events';
import { lte, sub, type UsdcUnits } from '@core/money';
import type { StoreId } from '@core/offers';
import type { TransferResult, Wallet } from './wallet';

// The judge-mode wallet: in memory, deterministic signatures "mock-1", "mock-2", … Nothing
// leaves the process, so `pnpm demo` needs no Solana setup.

export type MockTransfer = {
  readonly storeId: StoreId;
  readonly amount: UsdcUnits;
  readonly reference: string;
  readonly signature: string;
};

export type MockWallet = Wallet & { transfers(): readonly MockTransfer[] };

export function createMockWallet(opening: UsdcUnits): MockWallet {
  let balance = opening;
  const transfers: MockTransfer[] = [];
  const byReference = new Map<string, TransferResult>();

  return {
    kind: WalletKind.Mock,
    balance: () => Promise.resolve(balance),
    transfer(request) {
      const earlier = byReference.get(request.reference);
      if (earlier) return Promise.resolve(earlier);

      let result: TransferResult;
      if (!lte(request.amount, balance)) {
        result = {
          ok: false,
          detail: `insufficient balance: ${request.amount} base units asked, ${balance} held`,
          maybeMoved: false,
        };
      } else {
        balance = sub(balance, request.amount);
        const signature = `mock-${transfers.length + 1}`;
        transfers.push({ ...request, signature });
        result = { ok: true, signature };
      }
      byReference.set(request.reference, result);
      return Promise.resolve(result);
    },
    transfers: () => [...transfers],
  };
}
