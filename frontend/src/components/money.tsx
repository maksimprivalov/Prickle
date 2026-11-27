import { formatMoney, type Currency } from '@lib/format-money';
import { SourceRef } from './source-ref';

export type MoneyProps = {
  /** Integer cents (EUR) or base units (USDC), exactly as the event carried it. */
  value: number;
  currency: Currency;
  source: string;
  className?: string;
};

export function Money({ value, currency, source, className }: MoneyProps) {
  return (
    <SourceRef recordId={source}>
      <span className={className}>{formatMoney(value, currency)}</span>
    </SourceRef>
  );
}
