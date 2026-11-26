import type { UsdcUnits } from '@core/money';
import type { WalletKind } from '@core/events';
import type { StoreId } from '@core/offers';

// The wallet port. pay() talks to this; only select-wallet.ts knows whether money moves on
// Solana devnet or in memory. Switching is one env var (PAYMENTS), nothing else changes.

export type TransferRequest = {
  readonly storeId: StoreId;
  readonly amount: UsdcUnits;
  /**
   * One payment's identity, e.g. "<session>:<offer>". A second transfer with the same reference
   * returns the first result and moves no money, so a retry can never pay twice.
   */
  readonly reference: string;
};

export type TransferResult =
  | { readonly ok: true; readonly signature: string }
  | { readonly ok: false; readonly detail: string };

export type Wallet = {
  readonly kind: WalletKind;
  /** Test USDC the wallet holds right now, in base units. */
  balance(): Promise<UsdcUnits>;
  /** Never throws: a failed transfer is a result, so pay() can emit payment.failed. */
  transfer(request: TransferRequest): Promise<TransferResult>;
};
