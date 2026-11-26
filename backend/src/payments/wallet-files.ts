import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { StoreIdSchema } from '@core/offers';
import { z } from 'zod';

// Where `pnpm wallet:setup` keeps the devnet keys. `.wallet/` is gitignored; nothing in it is
// ever printed or committed.

export const WALLET_DIR = fileURLToPath(new URL('../../.wallet/', import.meta.url));
export const PAYER_FILE = fileURLToPath(new URL('../../.wallet/payer.json', import.meta.url));
export const STORES_FILE = fileURLToPath(new URL('../../.wallet/stores.json', import.meta.url));
/** Present only after `pnpm wallet:setup --own-mint`: our own devnet test token. */
export const MINT_FILE = fileURLToPath(new URL('../../.wallet/mint.json', import.meta.url));

/** The solana-keygen format: the 64-byte secret key as a JSON array. */
export const KeypairFile = z.array(z.int().min(0).max(255)).length(64);

/** Each store's devnet address (public keys only). */
export const StoresFile = z.record(StoreIdSchema, z.string().min(32).max(44));
export type StoresFile = z.infer<typeof StoresFile>;

export const MintFile = z.object({ mint: z.string().min(32).max(44), note: z.string() });

export function readPayerSecret(): Uint8Array {
  if (!existsSync(PAYER_FILE)) {
    throw new Error('No devnet wallet yet: run `pnpm wallet:setup` in backend/.');
  }
  const parsed = KeypairFile.safeParse(JSON.parse(readFileSync(PAYER_FILE, 'utf8')));
  // Never include the file's content in the error.
  if (!parsed.success) throw new Error(`${PAYER_FILE} is not a solana-keygen keypair file.`);
  return Uint8Array.from(parsed.data);
}

export function readStores(): StoresFile {
  if (!existsSync(STORES_FILE)) {
    throw new Error('No store addresses yet: run `pnpm wallet:setup` in backend/.');
  }
  return StoresFile.parse(JSON.parse(readFileSync(STORES_FILE, 'utf8')));
}

/** The devnet test token to pay with: our own mint if setup created one, else Circle's. */
export function readMintOverride(): string | undefined {
  if (!existsSync(MINT_FILE)) return undefined;
  return MintFile.parse(JSON.parse(readFileSync(MINT_FILE, 'utf8'))).mint;
}
