import { describe, expect, it } from 'vitest';
import { explorerTxUrl } from './explorer-url';

const signature =
  '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW';

describe('explorerTxUrl', () => {
  it('always points at devnet', () => {
    expect(explorerTxUrl(signature)).toBe(
      `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
    );
  });

  it('gives no link for a mock payment or anything that is not base58', () => {
    expect(explorerTxUrl('mock-1')).toBeUndefined();
    expect(explorerTxUrl(`${signature}?cluster=mainnet-beta`)).toBeUndefined();
    expect(explorerTxUrl('0OIl'.repeat(16))).toBeUndefined();
  });
});
