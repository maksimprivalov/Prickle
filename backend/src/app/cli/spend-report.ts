import { NOT_FINANCIAL_ADVICE } from '@core/disclaimer/disclaimer';
import type { WalletKind } from '@core/events';
import type { Mandate } from '@core/mandate';
import { EUR_TO_TEST_USDC_RATE_LABEL, formatUsdc, toUsdcUnits } from '@core/money';
import { MANDATE_RECORD_ID } from '@core/records';
import { explorerUrl } from '@payments/devnet';
import type { LedgerEntry } from '@payments/ledger';
import type { SessionOutcome } from '@core/events';

// The spend report: every number comes from the ledger or the mandate, with its record id.

export function spendReport(input: {
  readonly mandate: Mandate;
  readonly entries: readonly LedgerEntry[];
  readonly spent: LedgerEntry['total'];
  readonly wallet: WalletKind;
  readonly outcome: SessionOutcome;
}): string[] {
  const { mandate, entries, wallet, outcome } = input;
  const cap = toUsdcUnits(mandate.maxTotal);
  const lines = [
    `Spent ${formatUsdc(toUsdcUnits(input.spent))} of ${formatUsdc(cap)}  [${MANDATE_RECORD_ID}] (${EUR_TO_TEST_USDC_RATE_LABEL})`,
  ];
  for (const entry of entries) {
    if (entry.status === 'settled') {
      const link =
        wallet === 'devnet' ? explorerUrl(entry.signature) : `mock payment ${entry.signature}`;
      lines.push(
        `  ${entry.offerId}: ${formatUsdc(toUsdcUnits(entry.total))}  [${entry.recordId}]  ${link}`,
      );
    } else {
      lines.push(
        `  ${entry.offerId}: UNCERTAIN, counted as spent: ${entry.detail}  [${entry.recordId}]`,
      );
    }
  }
  if (outcome.kind === 'no_fit') {
    lines.push(
      outcome.bestOfferId
        ? `Nothing paid. Best option ${outcome.bestOfferId} falls outside the mandate:`
        : 'Nothing paid: no offer matched the mandate.',
    );
    for (const reason of outcome.reasons)
      lines.push(`  - ${reason.text}  [${reason.sources.join(', ')}]`);
  }
  if (outcome.kind === 'failed') lines.push(`The session failed: ${outcome.detail}`);
  lines.push(NOT_FINANCIAL_ADVICE);
  return lines;
}
