import { describe, expect, it } from 'vitest';
import { usdcUnits } from '@core/money';
import { assertDevnetRpcUrl, explorerUrl } from './devnet';
import { selectWallet } from './select-wallet';

describe('assertDevnetRpcUrl()', () => {
  it.each([
    'https://api.devnet.solana.com',
    'https://devnet.helius-rpc.com/?api-key=test-key',
    'http://localhost:8899',
    'http://127.0.0.1:8899',
  ])('accepts %s', (url) => {
    expect(() => assertDevnetRpcUrl(url)).not.toThrow();
  });

  it.each([
    'https://api.mainnet-beta.solana.com',
    'https://mainnet.helius-rpc.com',
    'https://api.testnet.solana.com',
    'https://rpc.example.com',
    'https://devnet-looking.mainnet.example.com',
    'not a url',
  ])('refuses %s', (url) => {
    expect(() => assertDevnetRpcUrl(url)).toThrow();
  });
});

describe('explorerUrl()', () => {
  it('always points at the devnet cluster', () => {
    expect(explorerUrl('5xSig')).toBe('https://explorer.solana.com/tx/5xSig?cluster=devnet');
  });
});

describe('selectWallet()', () => {
  const cap = usdcUnits(600_000_000);

  it('defaults to the mock wallet, funded with the cap', async () => {
    const wallet = await selectWallet({}, cap);
    expect(wallet.kind).toBe('mock');
    expect(await wallet.balance()).toBe(cap);
  });

  it('treats an empty PAYMENTS as the default', async () => {
    expect((await selectWallet({ PAYMENTS: '' }, cap)).kind).toBe('mock');
  });

  it('refuses an unknown wallet kind', async () => {
    await expect(selectWallet({ PAYMENTS: 'real' }, cap)).rejects.toThrow(/PAYMENTS/);
  });

  it('refuses a devnet wallet on a non-devnet RPC before connecting', async () => {
    await expect(
      selectWallet(
        { PAYMENTS: 'devnet', SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com' },
        cap,
      ),
    ).rejects.toThrow(/devnet or localhost/);
  });
});
