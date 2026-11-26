// pnpm wallet:setup [--own-mint] [--fund <usdc>]
//
// Prepares the opt-in devnet wallet (PAYMENTS=devnet). Judge mode never needs this.
//   1. Creates the payer keypair in .wallet/payer.json if missing. The secret is never printed.
//   2. Creates a devnet address for each store (public keys only) in .wallet/stores.json.
//   3. Checks the RPC is devnet, then airdrops test SOL if the payer is low.
//   4. Reports the test-USDC balance and how to fund it:
//      - default: Circle's devnet USDC, from https://faucet.circle.com;
//      - --own-mint: creates our own 6-decimal devnet test token and mints --fund (default 600)
//        to the payer, because the public faucet gives far less than a demo payment.
// Devnet only. Nothing here can touch real money.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { StoreId } from '@core/offers';
import { formatUsdc, toUsdcUnits, cents } from '@core/money';
import { DEVNET_RPC_URL, USDC_DECIMALS, USDC_DEVNET_MINT } from '@payments/devnet';
import { connectDevnet, paymentMint, usdcBalance } from '@payments/devnet-wallet';
import {
  MINT_FILE,
  PAYER_FILE,
  STORES_FILE,
  WALLET_DIR,
  readPayerSecret,
  readStores,
} from '@payments/wallet-files';
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token';
import { Keypair, LAMPORTS_PER_SOL, type Connection, type PublicKey } from '@solana/web3.js';

const MIN_SOL_LAMPORTS = LAMPORTS_PER_SOL / 2;

function ensureFiles(): Keypair {
  mkdirSync(WALLET_DIR, { recursive: true });
  if (!existsSync(PAYER_FILE)) {
    const fresh = Keypair.generate();
    writeFileSync(PAYER_FILE, JSON.stringify([...fresh.secretKey]), { mode: 0o600 });
    console.log('Created a new devnet payer keypair in .wallet/payer.json');
  }
  if (!existsSync(STORES_FILE)) {
    const stores = Object.fromEntries(
      Object.values(StoreId).map((id) => [id, Keypair.generate().publicKey.toBase58()]),
    );
    writeFileSync(STORES_FILE, `${JSON.stringify(stores, null, 2)}\n`);
    console.log('Created devnet store addresses in .wallet/stores.json');
  }
  return Keypair.fromSecretKey(readPayerSecret());
}

async function topUpSol(connection: Connection, payer: PublicKey): Promise<number> {
  let lamports = await connection.getBalance(payer);
  if (lamports >= MIN_SOL_LAMPORTS) return lamports;
  console.log('Requesting 1 test SOL from the devnet airdrop…');
  try {
    const signature = await connection.requestAirdrop(payer, LAMPORTS_PER_SOL);
    const latest = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature, ...latest }, 'confirmed');
    lamports = await connection.getBalance(payer);
  } catch (error) {
    console.log(
      `The airdrop failed (${error instanceof Error ? error.message : String(error)}).\n` +
        `Get test SOL at https://faucet.solana.com for ${payer.toBase58()}, then run this again.`,
    );
  }
  return lamports;
}

async function createOwnMint(connection: Connection, payer: Keypair, fundUsdc: number) {
  const mint = await createMint(connection, payer, payer.publicKey, null, USDC_DECIMALS);
  const account = await getOrCreateAssociatedTokenAccount(connection, payer, mint, payer.publicKey);
  // Integer path: whole USDC -> cents -> base units.
  const amount = toUsdcUnits(cents(fundUsdc * 100));
  await mintTo(connection, payer, mint, account.address, payer, BigInt(amount));
  writeFileSync(
    MINT_FILE,
    `${JSON.stringify({ mint: mint.toBase58(), note: 'Prickle devnet test token, 6 decimals' }, null, 2)}\n`,
  );
  console.log(
    `Created our own devnet test token ${mint.toBase58()} and minted ${fundUsdc} to the payer.`,
  );
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'own-mint': { type: 'boolean', default: false },
      fund: { type: 'string', default: '600' },
    },
  });
  const fundUsdc = Number(values.fund);
  if (!Number.isSafeInteger(fundUsdc) || fundUsdc <= 0) {
    throw new Error('--fund takes a whole number of test USDC, e.g. --fund 600');
  }

  const payer = ensureFiles();
  const rpcUrl = process.env.SOLANA_RPC_URL || DEVNET_RPC_URL;
  const connection = await connectDevnet(rpcUrl);
  console.log(`Devnet RPC: ${new URL(rpcUrl).host} (genesis checked)`);
  console.log(`Payer address: ${payer.publicKey.toBase58()}`);

  const lamports = await topUpSol(connection, payer.publicKey);
  console.log(`SOL balance: ${lamports / LAMPORTS_PER_SOL} test SOL`);

  if (values['own-mint'] && !existsSync(MINT_FILE)) {
    if (lamports < MIN_SOL_LAMPORTS / 10) throw new Error('Not enough test SOL to create a mint.');
    await createOwnMint(connection, payer, fundUsdc);
  }

  const mint = paymentMint();
  const own = mint.toBase58() !== USDC_DEVNET_MINT;
  const balance = await usdcBalance(connection, payer.publicKey, mint);
  console.log(
    `Paying with: ${own ? 'our own devnet test token' : "Circle's devnet USDC"} ${mint.toBase58()}`,
  );
  console.log(`Test USDC balance: ${formatUsdc(balance)}`);
  console.log('Store addresses:');
  for (const [store, address] of Object.entries(readStores()))
    console.log(`  ${store}: ${address}`);

  if (balance === 0) {
    console.log(
      own
        ? 'The own mint is empty: delete .wallet/mint.json and run with --own-mint again.'
        : `Not funded yet. Get devnet USDC at https://faucet.circle.com (Solana Devnet) for\n` +
            `${payer.publicKey.toBase58()}, or run: pnpm wallet:setup --own-mint`,
    );
    process.exitCode = 1;
    return;
  }
  console.log('Devnet wallet ready: run PAYMENTS=devnet pnpm demo. Not financial advice.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
