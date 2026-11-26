import { z } from 'zod';
import { EventName, GuardReasonCode, type GuardDecision, type PrickleEvent } from '@core/events';
import { checkPayment, type PaymentCheck } from '@core/guard/check-payment';
import { Mandate } from '@core/mandate';
import { toUsdcUnits, usdcUnits } from '@core/money';
import { CheckoutBreakdown, Offer, PriceHistoryRow, StoreProfile } from '@core/offers';
import type { Verdict } from '@core/verdicts';
import { defineTool, type RecordRegistry, type ToolInterceptor } from '@runtime/port';
import type { Ledger } from './ledger';
import type { Wallet } from './wallet';

// pay(): the only way money moves. The agent names an offer; everything else (the amount, the
// mandate, the verdicts) comes from records and shared state, never from what the agent typed.
// Steps: guard (again, even after interception), then transfer, then payment.settled or
// payment.failed. Not financial advice: Prickle checks offers against the user's own rules.

export const PAY_TOOL = 'pay';
const GUARD = 'guard';

/** The records one payment needs, as tools returned them in this run. */
export type OfferRecords = {
  readonly offer: Offer;
  readonly checkout: CheckoutBreakdown;
  readonly store: StoreProfile;
  readonly history: readonly PriceHistoryRow[];
};

export type PaySession = {
  readonly sessionId: string;
  /** The mandate from shared state, exactly as the user set it. */
  readonly mandate: () => unknown;
  readonly lookup: (offerId: string) => OfferRecords | undefined;
  readonly verdicts: (offerId: string) => readonly Verdict[];
  readonly wallet: Wallet;
  readonly ledger: Ledger;
  readonly records: RecordRegistry;
  readonly publish: (event: PrickleEvent) => void;
  readonly clock: () => Date;
};

/** Finds an offer's records among everything tools registered in this run. */
export function lookupFromRecords(records: RecordRegistry) {
  return (offerId: string): OfferRecords | undefined => {
    const all = records.all();
    const pick = <T extends { offerId?: string }>(schema: z.ZodType<T>) =>
      all.flatMap((r) => {
        const parsed = schema.safeParse(r);
        return parsed.success ? [parsed.data] : [];
      });
    const offer = pick(Offer).find((o) => o.offerId === offerId);
    const checkout = pick(CheckoutBreakdown).find((c) => c.offerId === offerId);
    if (!offer || !checkout) return undefined;
    const store = all.flatMap((r) => {
      const parsed = StoreProfile.safeParse(r);
      return parsed.success && parsed.data.storeId === offer.storeId ? [parsed.data] : [];
    })[0];
    if (!store) return undefined;
    const history = pick(PriceHistoryRow).filter((row) => row.offerId === offerId);
    return { offer, checkout, store, history };
  };
}

const missingRecords = (offerId: string): GuardDecision => ({
  allow: false,
  reasons: [
    {
      code: GuardReasonCode.GuardError,
      message: `The records for ${offerId} (offer, checkout, store) were not found in this run.`,
      compared: [],
      sources: [],
    },
  ],
});

/** Assembles the guard's input from records and state, and runs the guard. */
async function guardFor(
  session: PaySession,
  offerId: string,
): Promise<{ decision: GuardDecision; records?: OfferRecords }> {
  const records = session.lookup(offerId);
  if (!records) return { decision: missingRecords(offerId) };
  // Taken before the await, so two concurrent checks never share an id.
  const recordId = session.ledger.nextBalanceRecordId();
  const balanceRecord = { recordId, amount: await session.wallet.balance() };
  session.records.add([balanceRecord]);
  const check: PaymentCheck = {
    mandate: session.mandate(),
    ...records,
    history: [...records.history],
    verdicts: [...session.verdicts(offerId)],
    spent: session.ledger.spent(),
    balance: balanceRecord,
  };
  return { decision: checkPayment(check), records };
}

function publishDecision(session: PaySession, offerId: string, decision: GuardDecision): void {
  session.publish({
    type: EventName.GuardDecided,
    sessionId: session.sessionId,
    at: session.clock().toISOString(),
    agent: GUARD,
    offerId,
    decision,
  });
}

const PayInput = z.object({ offerId: z.string().min(1) });

export const PayOutput = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('paid'),
    offerId: z.string(),
    recordId: z.string(),
    amount: z.int(),
    signature: z.string(),
  }),
  z.object({
    status: z.literal('denied'),
    offerId: z.string(),
    reasons: z.array(z.object({ code: z.string(), message: z.string() })),
  }),
  z.object({ status: z.literal('failed'), offerId: z.string(), detail: z.string() }),
]);
export type PayOutput = z.infer<typeof PayOutput>;

export function createPayTool(session: PaySession) {
  return defineTool({
    name: PAY_TOOL,
    description:
      'Pays the checkout total of one offer from the session wallet. Give only the offer id: ' +
      'the amount comes from the checkout record, and the mandate guard decides first.',
    input: PayInput,
    output: PayOutput,
    run: ({ offerId }) => session.ledger.serialize(() => pay(session, offerId)),
  });
}

async function pay(session: PaySession, offerId: string): Promise<PayOutput> {
  const reference = `${session.sessionId}:${offerId}`;
  const earlier = session.ledger.find(reference);
  if (earlier?.status === 'settled') {
    return {
      status: 'paid',
      offerId,
      recordId: earlier.recordId,
      amount: toUsdcUnits(earlier.total),
      signature: earlier.signature,
    };
  }
  if (earlier?.status === 'uncertain') {
    return {
      status: 'failed',
      offerId,
      detail: `an earlier transfer for ${offerId} may have gone through (${earlier.detail}); not retried`,
    };
  }

  const { decision, records } = await guardFor(session, offerId);
  publishDecision(session, offerId, decision);
  if (!decision.allow || !records) {
    const reasons = decision.allow ? [] : decision.reasons;
    return {
      status: 'denied',
      offerId,
      reasons: reasons.map((r) => ({ code: r.code, message: r.message })),
    };
  }

  const { offer, checkout } = records;
  // Read before money moves, so nothing after the transfer can throw and lose payment.settled.
  const mandate = Mandate.safeParse(session.mandate());
  if (!mandate.success) {
    return {
      status: 'denied',
      offerId,
      reasons: [{ code: GuardReasonCode.InvalidMandate, message: 'The mandate is not valid.' }],
    };
  }
  const cap = toUsdcUnits(mandate.data.maxTotal);
  // Integer path: checkout total in cents -> test USDC base units at the one fixed rate.
  const amount = toUsdcUnits(checkout.total);
  const recordId = `${offerId}-pay-${session.ledger.entries().length + 1}`;
  const transfer = await session.wallet.transfer({ storeId: offer.storeId, amount, reference });
  const at = session.clock().toISOString();
  if (!transfer.ok) {
    if (transfer.maybeMoved) {
      // Fail closed: money that may be gone counts against the budget and is never retried.
      session.ledger.record({
        status: 'uncertain',
        reference,
        offerId,
        recordId,
        total: checkout.total,
        detail: transfer.detail,
      });
    }
    session.publish({
      type: EventName.PaymentFailed,
      sessionId: session.sessionId,
      at,
      agent: PAY_TOOL,
      offerId,
      wallet: session.wallet.kind,
      detail: transfer.detail,
    });
    return { status: 'failed', offerId, detail: transfer.detail };
  }

  session.ledger.record({
    status: 'settled',
    reference,
    offerId,
    recordId,
    total: checkout.total,
    signature: transfer.signature,
  });
  const spent = toUsdcUnits(session.ledger.spent().amount);
  const paymentRecord = { recordId, amount, signature: transfer.signature };
  session.records.add([paymentRecord]);
  session.publish({
    type: EventName.PaymentSettled,
    sessionId: session.sessionId,
    at,
    agent: PAY_TOOL,
    recordId,
    offerId,
    storeId: offer.storeId,
    amount,
    spent,
    cap,
    wallet: session.wallet.kind,
    signature: transfer.signature,
  });
  return {
    status: 'paid',
    offerId,
    recordId,
    amount: usdcUnits(amount),
    signature: transfer.signature,
  };
}

/**
 * The guard as interception, in front of pay(): the visible layer in the demo. A denial here
 * means pay() never runs, so this layer publishes guard.decided itself. pay() checks again.
 */
export function createGuardInterceptor(session: PaySession): ToolInterceptor {
  return {
    name: 'mandate-guard',
    matches: (call) => call.tool === PAY_TOOL,
    async decide(call) {
      const { offerId } = PayInput.parse(call.input);
      const { decision } = await guardFor(session, offerId);
      if (decision.allow) return { allow: true };
      publishDecision(session, offerId, decision);
      return { allow: false, reason: decision.reasons.map((r) => r.message).join(' ') };
    },
  };
}
