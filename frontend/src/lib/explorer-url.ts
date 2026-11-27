// Explorer links are devnet only, and only for a real base58 signature. A mock-wallet
// signature ("mock-1") gets no link: the UI labels it "mock payment".

const BASE58_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{32,90}$/;

export function explorerTxUrl(signature: string): string | undefined {
  if (!BASE58_SIGNATURE.test(signature)) return undefined;
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}
