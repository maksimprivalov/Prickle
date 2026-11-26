import { WalletKind } from '@core/events';
import { usdcUnits, type UsdcUnits } from '@core/money';
import {
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  TokenAccountNotFoundError,
  transferChecked,
} from '@solana/spl-token';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import {
  DEVNET_GENESIS_HASH,
  USDC_DECIMALS,
  USDC_DEVNET_MINT,
  assertDevnetRpcUrl,
  isLocalRpc,
} from './devnet';
import { readMintOverride, readPayerSecret, readStores, type StoresFile } from './wallet-files';
import type { TransferResult, Wallet } from './wallet';

// Real test-USDC transfers on Solana devnet (PAYMENTS=devnet). Opt-in: judge mode never needs it.

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Refuses to start unless the RPC is devnet (by URL and by genesis hash) or a local validator. */
export async function connectDevnet(rpcUrl: string): Promise<Connection> {
  const url = assertDevnetRpcUrl(rpcUrl);
  const connection = new Connection(url.toString(), 'confirmed');
  if (!isLocalRpc(url)) {
    const genesis = await connection.getGenesisHash();
    if (genesis !== DEVNET_GENESIS_HASH) {
      throw new Error(`${url.host} is not Solana devnet (genesis ${genesis}); refusing to sign.`);
    }
  }
  return connection;
}

/** Our own test mint when `wallet:setup --own-mint` made one, else Circle's devnet USDC. */
export function paymentMint(): PublicKey {
  return new PublicKey(readMintOverride() ?? USDC_DEVNET_MINT);
}

export async function usdcBalance(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey,
): Promise<UsdcUnits> {
  try {
    const account = await getAccount(connection, getAssociatedTokenAddressSync(mint, owner));
    return usdcUnits(Number(account.amount));
  } catch (error) {
    if (error instanceof TokenAccountNotFoundError) return usdcUnits(0);
    throw error;
  }
}

export async function createDevnetWallet(options: {
  readonly rpcUrl: string;
  readonly payer?: Keypair;
  readonly stores?: StoresFile;
  readonly mint?: PublicKey;
}): Promise<Wallet> {
  const connection = await connectDevnet(options.rpcUrl);
  const payer = options.payer ?? Keypair.fromSecretKey(readPayerSecret());
  const stores = options.stores ?? readStores();
  const mint = options.mint ?? paymentMint();
  const source = getAssociatedTokenAddressSync(mint, payer.publicKey);
  // In-flight and finished transfers by reference, so a retry never pays twice.
  const byReference = new Map<string, Promise<TransferResult>>();

  async function send(storeId: keyof StoresFile, amount: UsdcUnits): Promise<TransferResult> {
    const address = stores[storeId];
    if (!address) return { ok: false, detail: `no devnet address for store ${storeId}` };
    try {
      const destination = await getOrCreateAssociatedTokenAccount(
        connection,
        payer,
        mint,
        new PublicKey(address),
      );
      const signature = await transferChecked(
        connection,
        payer,
        source,
        mint,
        destination.address,
        payer,
        BigInt(amount),
        USDC_DECIMALS,
      );
      return { ok: true, signature };
    } catch (error) {
      return { ok: false, detail: `devnet transfer failed: ${messageOf(error)}` };
    }
  }

  return {
    kind: WalletKind.Devnet,
    balance: () => usdcBalance(connection, payer.publicKey, mint),
    transfer(request) {
      const earlier = byReference.get(request.reference);
      if (earlier) return earlier;
      const result = send(request.storeId, request.amount);
      byReference.set(request.reference, result);
      return result;
    },
  };
}
