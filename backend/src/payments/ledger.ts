import { add, cents, type Cents } from '@core/money';
import { MANDATE_RECORD_ID, type SourcedCents } from '@core/records';

// What this session has paid, in order. The guard reads `spent()` so a second payment counts
// the first; pay() reads `find()` so a retry for the same offer never pays twice.

type EntryBase = {
  readonly reference: string;
  readonly offerId: string;
  readonly recordId: string;
  readonly total: Cents;
};

export type LedgerEntry =
  | (EntryBase & { readonly status: 'settled'; readonly signature: string })
  /** A transfer that failed but may have moved money: counted as spent, never retried. */
  | (EntryBase & { readonly status: 'uncertain'; readonly detail: string });

export type Ledger = {
  find(reference: string): LedgerEntry | undefined;
  /**
   * Total paid so far, uncertain transfers included, citing the latest payment record (the
   * mandate when nothing is paid).
   */
  spent(): SourcedCents;
  record(entry: LedgerEntry): void;
  entries(): readonly LedgerEntry[];
  /** A fresh id for a wallet-balance record: "wallet-balance-1", "wallet-balance-2", … */
  nextBalanceRecordId(): string;
  /** Runs payments one at a time, so two concurrent ones cannot both fit the same budget. */
  serialize<T>(work: () => Promise<T>): Promise<T>;
};

export function createLedger(): Ledger {
  const entries: LedgerEntry[] = [];
  let queue: Promise<unknown> = Promise.resolve();
  let balanceReads = 0;

  return {
    find: (reference) => entries.find((e) => e.reference === reference),
    spent() {
      const last = entries.at(-1);
      return {
        amount: entries.reduce((total, e) => add(total, e.total), cents(0)),
        recordId: last?.recordId ?? MANDATE_RECORD_ID,
      };
    },
    record(entry) {
      entries.push(entry);
    },
    entries: () => [...entries],
    nextBalanceRecordId: () => `wallet-balance-${++balanceReads}`,
    serialize<T>(work: () => Promise<T>): Promise<T> {
      const run = queue.then(work, work);
      queue = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}
