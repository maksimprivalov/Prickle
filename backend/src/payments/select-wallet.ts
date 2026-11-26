import { WalletKind } from '@core/events';
import type { UsdcUnits } from '@core/money';
import { z } from 'zod';
import { DEVNET_RPC_URL } from './devnet';
import { createDevnetWallet } from './devnet-wallet';
import { createMockWallet } from './mock-wallet';
import type { Wallet } from './wallet';

// The only place that reads PAYMENTS. The Thu 17:00 fallback is this env var, nothing else.

const PaymentsEnv = z.object({
  PAYMENTS: z.enum(WalletKind).default(WalletKind.Mock),
  SOLANA_RPC_URL: z.url().default(DEVNET_RPC_URL),
});

export async function selectWallet(
  env: Readonly<Record<string, string | undefined>>,
  /** The mock wallet is funded with the mandate's cap, like the devnet one should be. */
  mockOpening: UsdcUnits,
): Promise<Wallet> {
  const parsed = PaymentsEnv.safeParse({
    PAYMENTS: env.PAYMENTS || undefined,
    SOLANA_RPC_URL: env.SOLANA_RPC_URL || undefined,
  });
  if (!parsed.success) throw new Error(`Bad payment settings: ${z.prettifyError(parsed.error)}`);
  return parsed.data.PAYMENTS === WalletKind.Devnet
    ? createDevnetWallet({ rpcUrl: parsed.data.SOLANA_RPC_URL })
    : createMockWallet(mockOpening);
}
