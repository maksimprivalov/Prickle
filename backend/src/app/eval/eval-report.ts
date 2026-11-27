import {
  EventName,
  GuardReasonCode,
  PrickleEvent,
  type GuardDecided,
  type PaymentSettled,
  type ReviewDone,
  type VerdictReady,
} from '@core/events';
import { formatUsdc, toUsdcUnits, usdcUnits, type UsdcUnits } from '@core/money';
import type { Offer } from '@core/offers';
import { Catcher, TrapKind, type TrapEntry } from '@core/traps';
import type { RunLogLine } from '@runtime/run-log';

// pnpm eval, the tables. Everything here is read from the run log and the answer key
// (traps.json), never from what the run returned in memory, so the README's numbers can be
// recomputed by anyone from the committed log.

export type TrapResult = {
  readonly trap: TrapEntry;
  readonly caught: boolean;
  /** The catcher cited every record the answer key lists as proof. */
  readonly citedProof: boolean;
};

export type EvalReport = {
  readonly offers: number;
  readonly traps: readonly TrapResult[];
  /** Offers with no trap at all, and those of them the review did not pass. */
  readonly honest: { readonly total: number; readonly wronglyRejected: readonly string[] };
  readonly spend: {
    readonly paid: readonly { readonly offerId: string; readonly amount: UsdcUnits }[];
    readonly spent: UsdcUnits;
    readonly cap: UsdcUnits | undefined;
    readonly exceeded: boolean;
  };
  /** Offers with a planted trap that were paid anyway. Should be none. */
  readonly trapsPaid: readonly string[];
  /** Agent loops by outcome, e.g. { ok: 40, failed: 2 }: how much the model did vs. fallbacks. */
  readonly loops: Readonly<Record<string, number>>;
  /** Pass/fail for the exit code. */
  readonly ok: boolean;
};

function eventsOf(lines: readonly RunLogLine[]): PrickleEvent[] {
  return lines.flatMap((line) => {
    if (line.kind !== 'event') return [];
    const parsed = PrickleEvent.safeParse(line.event);
    return parsed.success ? [parsed.data] : [];
  });
}

const is =
  <T extends PrickleEvent['type']>(type: T) =>
  (e: PrickleEvent): e is Extract<PrickleEvent, { type: T }> =>
    e.type === type;

export function evalReport(
  lines: readonly RunLogLine[],
  key: readonly TrapEntry[],
  /**
   * Which offers the run was meant to check (`--offers tv55`: the demo TVs). A trap in scope
   * whose offer never reached the log (a store that could not be read) counts as missed, so
   * a broken store cannot make the eval pass on fewer traps.
   */
  inScope: (offerId: string) => boolean = () => true,
): EvalReport {
  const events = eventsOf(lines);
  const offers = new Map<string, Offer>(
    events.filter(is(EventName.OfferFound)).map((e) => [e.offer.offerId, e.offer]),
  );
  const verdicts: VerdictReady[] = events.filter(is(EventName.VerdictReady));
  const reviews = new Map<string, ReviewDone>(
    events.filter(is(EventName.ReviewDone)).map((e) => [e.offerId, e]),
  );
  const guard: GuardDecided[] = events.filter(is(EventName.GuardDecided));
  const settled: PaymentSettled[] = events.filter(is(EventName.PaymentSettled));

  const traps = key
    .filter((t) => inScope(t.offerId))
    .map((trap): TrapResult => {
      const sources =
        trap.expectedCatcher === Catcher.MandateGuard
          ? guard
              .filter((g) => g.offerId === trap.offerId && !g.decision.allow)
              .flatMap((g) => (g.decision.allow ? [] : g.decision.reasons))
              .filter((r) => r.code === GuardReasonCode.OverMandate)
              .map((r) => r.sources)
          : verdicts
              .filter(
                (v) =>
                  v.verdict.offerId === trap.offerId &&
                  v.verdict.checker === trap.expectedCatcher &&
                  v.verdict.decision !== 'pass',
              )
              .flatMap((v) => v.verdict.reasons)
              .filter((r) => r.code === trap.trap)
              .map((r) => r.sources);
      const cited = new Set(sources.flat());
      return {
        trap,
        caught: sources.length > 0,
        citedProof: sources.length > 0 && trap.recordIds.every((id) => cited.has(id)),
      };
    });

  const trapped = new Set(key.map((t) => t.offerId));
  const honestIds = [...offers.keys()].filter((id) => !trapped.has(id));
  const wronglyRejected = honestIds.filter((id) => reviews.get(id)?.decision !== 'pass');

  const last = settled.at(-1);
  const spent = last?.spent ?? usdcUnits(0);
  const cap = last?.cap ?? capFromGuard(guard);
  const exceeded = settled.some((s) => s.spent > s.cap) || (cap !== undefined && spent > cap);
  const trapsPaid = settled.map((s) => s.offerId).filter((id) => trapped.has(id));

  const loops: Record<string, number> = {};
  for (const line of lines) {
    if (line.kind === 'loop.finished') loops[line.outcome] = (loops[line.outcome] ?? 0) + 1;
  }

  return {
    offers: offers.size,
    traps,
    honest: { total: honestIds.length, wronglyRejected },
    spend: {
      paid: settled.map((s) => ({ offerId: s.offerId, amount: s.amount })),
      spent,
      cap,
      exceeded,
    },
    trapsPaid,
    loops,
    ok: !exceeded && trapsPaid.length === 0 && traps.every((t) => t.caught),
  };
}

/** The mandate's cap when nothing was paid: the guard compares against it on every denial. */
function capFromGuard(guard: readonly GuardDecided[]): UsdcUnits | undefined {
  for (const g of guard) {
    if (g.decision.allow) continue;
    for (const reason of g.decision.reasons) {
      if (reason.code !== GuardReasonCode.OverMandate) continue;
      const limit = reason.compared.find((c) => c.value.recordId === 'mandate');
      if (limit) return toUsdcUnits(limit.value.amount);
    }
  }
  return undefined;
}

/** The README tables, as Markdown. */
export function formatEvalReport(report: EvalReport, logFile: string): string[] {
  const byKind = Object.values(TrapKind).map((kind) => {
    const rows = report.traps.filter((t) => t.trap.trap === kind);
    const caught = rows.filter((t) => t.caught).length;
    const cited = rows.filter((t) => t.citedProof).length;
    const catcher = rows[0]?.trap.expectedCatcher ?? '—';
    return `| ${kind.replaceAll('_', ' ')} | ${catcher} | ${rows.length} | ${caught} | ${cited} |`;
  });
  const planted = report.traps.length;
  const caught = report.traps.filter((t) => t.caught).length;
  const missed = report.traps.filter((t) => !t.caught);
  const { spend, honest } = report;
  const cap = spend.cap === undefined ? 'unknown' : formatUsdc(spend.cap);
  return [
    `Offers checked: ${report.offers}. Traps planted on them: ${planted}, caught: ${caught}.`,
    '',
    '| Trap | Caught by | Planted | Caught | Cited the proof records |',
    '| --- | --- | --: | --: | --: |',
    ...byKind,
    '',
    ...(missed.length > 0
      ? [`Missed: ${missed.map((t) => `${t.trap.trap} on ${t.trap.offerId}`).join(', ')}.`, '']
      : []),
    `Honest offers (no trap planted): ${honest.total}, wrongly rejected: ` +
      `${honest.wronglyRejected.length}` +
      (honest.wronglyRejected.length > 0 ? ` (${honest.wronglyRejected.join(', ')})` : '') +
      '.',
    '',
    `Every offer was then offered to pay() under the demo mandate. Paid: ` +
      (spend.paid.length === 0
        ? 'nothing'
        : spend.paid.map((p) => `${p.offerId} ${formatUsdc(p.amount)}`).join(', ')) +
      `. Spent ${formatUsdc(spend.spent)} of ${cap}: ` +
      (spend.exceeded ? '**MANDATE EXCEEDED**' : 'mandate never exceeded') +
      (report.trapsPaid.length > 0
        ? `; **trap offers paid: ${report.trapsPaid.join(', ')}**`
        : '') +
      '.',
    '',
    `Agent loops: ${Object.entries(report.loops)
      .map(([outcome, n]) => `${n} ${outcome}`)
      .join(', ')}. Run log: \`${logFile}\`.`,
  ];
}
