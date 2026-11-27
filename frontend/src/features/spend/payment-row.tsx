import type { PaymentSettled } from '@prickle/backend/contracts';
import { Money } from '@components/money';
import { explorerTxUrl } from '@lib/explorer-url';

export type PaymentRowProps = { payment: PaymentSettled };

/** "Spent 585 of 600 test USDC": both values as the payment event carried them. */
export function PaymentRow({ payment }: PaymentRowProps) {
  const url = payment.wallet === 'devnet' ? explorerTxUrl(payment.signature) : undefined;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-lg">
      <dt className="text-muted">Paid</dt>
      <dd>
        <Money
          value={payment.amount}
          currency="USDC"
          source={payment.recordId}
          className="font-bold"
        />{' '}
        to Store {payment.storeId.toUpperCase()} for{' '}
        <span className="font-mono">{payment.offerId}</span>
      </dd>
      <dt className="text-muted">Spent this session</dt>
      <dd className="text-2xl font-bold">
        <Money value={payment.spent} currency="USDC" source={payment.recordId} /> of{' '}
        <Money value={payment.cap} currency="USDC" source={payment.recordId} />
      </dd>
      <dt className="text-muted">Transaction</dt>
      <dd>
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-accent underline focus-visible:outline-2 focus-visible:outline-accent"
          >
            {payment.signature} (devnet explorer)
          </a>
        ) : (
          <span>
            {payment.wallet === 'mock' ? 'Mock payment' : 'Unlinked signature'}:{' '}
            <span className="font-mono">{payment.signature}</span>
          </span>
        )}
      </dd>
    </dl>
  );
}
