import { z } from 'zod';
import { omnibus30Day } from '../deal/omnibus-30-day';
import { GuardReasonCode, type GuardDecision, type GuardReason } from '../events/payment-events';
import { Mandate } from '../mandate';
import { add, formatEur, formatUsdc, lte, toUsdcUnits } from '../money';
import { CheckoutBreakdown, Offer, PriceHistoryRow, StoreProfile } from '../offers';
import { MANDATE_RECORD_ID, SourcedCents, SourcedUsdc } from '../records';
import { Checker, ReasonCode, Verdict } from '../verdicts';

// The mandate guard: plain code, not an LLM. It decides whether money may move, from the
// mandate as the user set it and from records, never from what an agent says. It runs twice:
// as Mozaik interception before the pay() step, and inside pay() itself.
//
// Every check runs every time, so a denial lists every reason. Anything unexpected (bad input,
// records that do not belong together, a thrown error) is a denial: the guard fails closed.

/** The checkers that must have looked at an offer before it can be paid. */
export const REQUIRED_CHECKERS = [Checker.DealVerifier, Checker.MerchantRisk] as const;

export const PaymentCheck = z.object({
  /** From shared state, as the user set it. Parsed separately: a bad one is its own reason. */
  mandate: z.unknown(),
  offer: Offer,
  checkout: CheckoutBreakdown,
  store: StoreProfile,
  /** The offer's price history; the 30-day rule is recomputed here, not taken from a verdict. */
  history: z.array(PriceHistoryRow),
  verdicts: z.array(Verdict),
  /** Paid so far in this session, citing the last payment record (or the mandate when 0). */
  spent: SourcedCents,
  /** What the wallet holds, citing the balance record. */
  balance: SourcedUsdc,
});
export type PaymentCheck = z.input<typeof PaymentCheck>;

const reason = (
  code: GuardReason['code'],
  message: string,
  compared: GuardReason['compared'],
  sources: GuardReason['sources'],
): GuardReason => ({ code, message, compared, sources });

const deny = (first: GuardReason, ...rest: GuardReason[]): GuardDecision => ({
  allow: false,
  reasons: [first, ...rest],
});

const guardError = (message: string) => deny(reason(GuardReasonCode.GuardError, message, [], []));

export function checkPayment(input: PaymentCheck): GuardDecision {
  try {
    return decide(input);
  } catch (error) {
    return guardError(
      `the guard failed, so it denies: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function decide(input: PaymentCheck): GuardDecision {
  const parsed = PaymentCheck.safeParse(input);
  if (!parsed.success)
    return guardError(`payment check input is invalid: ${z.prettifyError(parsed.error)}`);
  const { offer, checkout, store, history, verdicts, spent, balance } = parsed.data;

  const mandateResult = Mandate.safeParse(parsed.data.mandate);
  if (!mandateResult.success) {
    return deny(
      reason(
        GuardReasonCode.InvalidMandate,
        'There is no valid mandate, so nothing may be paid.',
        [],
        [MANDATE_RECORD_ID],
      ),
    );
  }
  const mandate = mandateResult.data;

  // Records that do not belong to the same offer mean the caller mixed something up.
  if (checkout.offerId !== offer.offerId || store.storeId !== offer.storeId) {
    return guardError(
      `records do not belong together: offer ${offer.offerId} at store ${offer.storeId}, ` +
        `checkout for ${checkout.offerId}, profile of store ${store.storeId}`,
    );
  }

  const reasons: GuardReason[] = [];
  const total = { amount: checkout.total, recordId: checkout.recordId };
  const max = { amount: mandate.maxTotal, recordId: MANDATE_RECORD_ID };

  // 1. The offer is what the user asked for.
  const sizeMismatch =
    mandate.screenInches !== undefined && offer.screenInches !== mandate.screenInches;
  if (offer.category !== mandate.category || sizeMismatch) {
    reasons.push(
      reason(
        GuardReasonCode.ProductMismatch,
        `"${offer.title}" is not a ${mandate.description}.`,
        [],
        [offer.recordId, MANDATE_RECORD_ID],
      ),
    );
  }

  // 2. The total at checkout, fees included, fits what is left of the mandate.
  if (!lte(add(checkout.total, spent.amount), mandate.maxTotal)) {
    const already = spent.amount > 0 ? ` after ${formatEur(spent.amount)} already spent` : '';
    reasons.push(
      reason(
        GuardReasonCode.OverMandate,
        `The checkout total ${formatEur(checkout.total)} is over the mandate's ` +
          `${formatEur(mandate.maxTotal)}${already}.`,
        [
          { label: 'Checkout total', value: total },
          { label: 'Mandate maximum', value: max },
          { label: 'Already spent', value: spent },
        ],
        [checkout.recordId, MANDATE_RECORD_ID, spent.recordId],
      ),
    );
  }

  // 3. The store is trusted, when the mandate asks for it.
  if (mandate.trustedStoresOnly && !store.trusted) {
    reasons.push(
      reason(
        GuardReasonCode.UntrustedStore,
        `${store.name} is not a trusted store, and the mandate allows trusted stores only.`,
        [],
        [store.recordId, MANDATE_RECORD_ID],
      ),
    );
  }

  // 4. The discount is real by the EU 30-day rule, when the mandate asks for it.
  if (mandate.requireRealDiscount) {
    const deal = omnibus30Day(offer, history);
    if (deal.code !== ReasonCode.RealDiscount) {
      const why =
        deal.code === ReasonCode.FakeDiscount
          ? `the "was" price ${formatEur(deal.wasPrice.amount)} is above the lowest price of the ` +
            `30 days before the reduction, ${formatEur(deal.lowest30.amount)}`
          : deal.code === ReasonCode.HistoryTooShort
            ? 'there are fewer than 30 days of price history before the reduction'
            : 'the offer claims no discount';
      reasons.push(
        reason(
          GuardReasonCode.DiscountNotVerified,
          `The mandate asks for a real discount, but ${why}.`,
          deal.code === ReasonCode.FakeDiscount
            ? [
                { label: '"Was" price', value: deal.wasPrice },
                { label: 'Lowest price in the 30 days before', value: deal.lowest30 },
              ]
            : [],
          deal.code === ReasonCode.FakeDiscount
            ? [offer.recordId, ...deal.lowestRows]
            : [...deal.sources, MANDATE_RECORD_ID],
        ),
      );
    }
  }

  // 5. Every required checker has looked at this offer.
  const checked = new Set(
    verdicts.filter((v) => v.offerId === offer.offerId).map((v) => v.checker),
  );
  const missing = REQUIRED_CHECKERS.filter((checker) => !checked.has(checker));
  if (missing.length > 0) {
    reasons.push(
      reason(
        GuardReasonCode.MissingVerdict,
        `No verdict yet from ${missing.join(' and ')} on ${offer.offerId}.`,
        [],
        [offer.recordId],
      ),
    );
  }

  // 6. The wallet holds enough.
  if (!lte(toUsdcUnits(checkout.total), balance.amount)) {
    reasons.push(
      reason(
        GuardReasonCode.InsufficientBalance,
        `The wallet holds ${formatUsdc(balance.amount)}, less than the checkout total ` +
          `${formatEur(checkout.total)}.`,
        [{ label: 'Checkout total', value: total }],
        [checkout.recordId, balance.recordId],
      ),
    );
  }

  const [first, ...rest] = reasons;
  return first === undefined ? { allow: true } : deny(first, ...rest);
}
