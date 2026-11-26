// Solana devnet only: test SOL and test USDC, never real money (hackathon rule).

export const DEVNET_RPC_URL = 'https://api.devnet.solana.com';

/** Devnet's genesis hash. A remote RPC that reports anything else is not devnet. */
export const DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';

/** Circle's test USDC mint on devnet (faucet.circle.com). 6 decimals, like USDC. */
export const USDC_DEVNET_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
export const USDC_DECIMALS = 6;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function isLocalRpc(url: URL): boolean {
  return LOCAL_HOSTS.has(url.hostname);
}

/**
 * Refuses any RPC URL that is not devnet or a local validator. The URL is only a first check;
 * the devnet wallet also compares the cluster's genesis hash before it signs anything.
 */
export function assertDevnetRpcUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`SOLANA_RPC_URL is not a URL: ${raw}`);
  }
  const host = url.hostname.toLowerCase();
  const devnet = host.includes('devnet') && !host.includes('mainnet') && !host.includes('testnet');
  if (!devnet && !isLocalRpc(url)) {
    throw new Error(`SOLANA_RPC_URL must point at devnet or localhost, got ${url.host}`);
  }
  return url;
}

export function explorerUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}
