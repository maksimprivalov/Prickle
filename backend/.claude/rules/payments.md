---
paths:
  - "src/payments/**/*.ts"
  - "scripts/wallet*.ts"
---

# Payments — devnet only

Hackathon rule: no real accounts, no real money. Solana devnet and test USDC only.

## Shape

```text
payments/
  wallet.ts         Wallet port: balance(), transfer(to, amount: UsdcUnits) -> { signature }
  mock-wallet.ts    in-memory, deterministic signatures "mock-<n>"; the default
  devnet-wallet.ts  @solana/web3.js + SPL token, devnet USDC mint
  pay.ts            the pay() tool: guard first, then wallet.transfer, then payment.settled
  select-wallet.ts  PAYMENTS=mock|devnet -> Wallet; the only place that reads it
```

- Switching mock ↔ devnet changes one env var and nothing in agents, tools or core (the Thu
  17:00 fallback must be one line).

## `pay()`

1. Parse input with zod. Amount is `UsdcUnits` from `core/money`, converted from the checkout
   total in `Cents`, never from a number an agent typed.
2. Call `core/guard.checkPayment` itself, even though Mozaik interception already did. On deny:
   emit `guard.decided` with the reasons and return; never transfer.
3. Transfer. On success emit `payment.settled` with the signature and, for devnet, the explorer
   URL `https://explorer.solana.com/tx/<sig>?cluster=devnet`.
4. On failure emit `payment.failed` with the reason. No retry that could pay twice: a retry
   checks the ledger for the session first.

## Devnet

- RPC URL from `SOLANA_RPC_URL`, default the devnet public endpoint. At start-up, refuse any URL
  that is not devnet (or localhost). The command guard hook also blocks mainnet in Bash.
- The keypair lives in `.wallet/` (gitignored), written by `pnpm wallet:setup`. Claude cannot
  read it (settings deny) and must never print it; check it exists with `test -f`.
- Fund it with the SOL airdrop and Circle's devnet USDC faucet. Fund only up to the mandate.
- Store addresses are devnet addresses generated for the fixtures, listed in the data.
- Amounts are integer base units (6 decimals). No float anywhere on the path to `transfer`.

## Optional later (only after the must-haves)

Kora as a policy-enforced signer; x402 on the price-history API paid from the same budget. Both
are first on the cut list.
