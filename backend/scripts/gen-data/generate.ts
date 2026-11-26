import { Mandate } from '@core/mandate';
import { cents, sum, type Cents } from '@core/money';
import {
  CheckoutBreakdown,
  CheckoutLineKind,
  Offer,
  PriceHistoryRow,
  StoreId,
  StoreProfile,
  type CheckoutLine,
  type ReturnPolicy,
} from '@core/offers';
import { MANDATE_RECORD_ID } from '@core/records';
import { Catcher, TrapEntry, TrapKind } from '@core/traps';
import { createPrng, type Prng } from './prng';

// The synthetic world Prickle shops in: 5 fictional stores, 8 offers each, 60 days of daily
// prices per offer, a checkout breakdown per offer, and the answer key of planted traps.
// Pure and seeded: generate(seed) twice gives identical output. Dates are relative to a fixed
// Black Friday, never to today.

export const DEFAULT_SEED = 20261127;
export const BLACK_FRIDAY = '2026-11-27';
export const HISTORY_DAYS = 60;
/** The 30-day lookback of the EU Omnibus Directive, Art. 6a. */
const OMNIBUS_DAYS = 30;
const DEMO_REDUCTION_START = '2026-11-20';

/** The demo mandate. Over-budget traps are planted against it. */
export const DEMO_MANDATE: Mandate = Mandate.parse({
  description: '55-inch TV',
  category: 'tv',
  screenInches: 55,
  maxTotal: 60_000,
  requireRealDiscount: true,
  trustedStoresOnly: true,
});

// --- Stores ----------------------------------------------------------------------------------

const Practice = {
  Honest: 'honest',
  FakeDiscounts: 'fake_discounts',
  HiddenFee: 'hidden_fee',
  Scarcity: 'scarcity',
} as const;
type Practice = (typeof Practice)[keyof typeof Practice];

type StoreSpec = {
  id: StoreId;
  name: string;
  domainAgeDays: number;
  returnPolicy: ReturnPolicy;
  trusted: boolean;
  practice: Practice;
};

const STORES: readonly StoreSpec[] = [
  {
    id: StoreId.A,
    name: 'Pixel Harbour',
    domainAgeDays: 4380,
    returnPolicy: { kind: 'refund', days: 30 },
    trusted: true,
    practice: Practice.Honest,
  },
  {
    id: StoreId.B,
    name: 'Lumen & Lark',
    domainAgeDays: 3285,
    returnPolicy: { kind: 'refund', days: 30 },
    trusted: true,
    practice: Practice.Honest,
  },
  {
    id: StoreId.C,
    name: 'Volt Bazaar',
    domainAgeDays: 2190,
    returnPolicy: { kind: 'refund', days: 14 },
    trusted: true,
    practice: Practice.FakeDiscounts,
  },
  {
    id: StoreId.D,
    name: 'Gridline Goods',
    domainAgeDays: 1460,
    returnPolicy: { kind: 'refund', days: 30 },
    trusted: true,
    practice: Practice.HiddenFee,
  },
  {
    id: StoreId.E,
    name: 'MegaFlash Outlet',
    domainAgeDays: 41,
    returnPolicy: { kind: 'all_sales_final' },
    trusted: false,
    practice: Practice.Scarcity,
  },
];

// --- Price plans -----------------------------------------------------------------------------

/** How an offer's price moved over the 60 days. All amounts in whole euros. */
type PricePlan =
  | { kind: 'none'; price: number; noise: boolean }
  /** An honest reduction: `was` is the lowest price in the 30 days before `reductionStart`. */
  | { kind: 'real'; price: number; was: number; reductionStart: string; noise: boolean }
  /** Raised to `was` on `raiseStart`, then "cut" back to `price`: the fake-discount trap. */
  | { kind: 'fake'; price: number; was: number; raiseStart: string; reductionStart: string };

type ProductSpec = {
  slug: string;
  category: string;
  screenInches?: number;
  baseEur: number;
  models: readonly string[];
};

/** The demo 55-inch TV in each store: fixed, so the example run never drifts with the seed. */
const DEMO_TVS: Readonly<Record<StoreId, { title: string; plan: PricePlan }>> = {
  // Real deal, above the mandate: over budget.
  a: {
    title: 'Aurora Vision 55" 4K QLED TV',
    plan: {
      kind: 'real',
      price: 749,
      was: 899,
      reductionStart: DEMO_REDUCTION_START,
      noise: false,
    },
  },
  // €699 until the reduction, then €585, 30-day refunds, trusted: the offer that passes.
  b: {
    title: 'Kestrel 55" 4K UHD Smart TV',
    plan: {
      kind: 'real',
      price: 585,
      was: 699,
      reductionStart: DEMO_REDUCTION_START,
      noise: false,
    },
  },
  // €599 in October, €649 from 1 November, "cut" to €599: fake discount.
  c: {
    title: 'Novabright 55" 4K LED TV',
    plan: {
      kind: 'fake',
      price: 599,
      was: 649,
      raiseStart: '2026-11-01',
      reductionStart: DEMO_REDUCTION_START,
    },
  },
  // Real discount, but a €49 service fee appears only at checkout: €599 becomes €648.
  d: {
    title: 'Tidewave 55" 4K HDR TV',
    plan: {
      kind: 'real',
      price: 599,
      was: 679,
      reductionStart: DEMO_REDUCTION_START,
      noise: false,
    },
  },
  // Cheapest and a real discount, but untrusted, "only 2 left!" everywhere, all sales final.
  e: {
    title: 'MEGA DEAL! Orbis 55" 4K Smart TV',
    plan: {
      kind: 'real',
      price: 559,
      was: 799,
      reductionStart: DEMO_REDUCTION_START,
      noise: false,
    },
  },
};

const OTHER_PRODUCTS: readonly ProductSpec[] = [
  {
    slug: 'tv65',
    category: 'tv',
    screenInches: 65,
    baseEur: 899,
    models: [
      'Aurora Vision 65" 4K QLED TV',
      'Kestrel 65" 4K UHD Smart TV',
      'Orbis 65" Mini-LED TV',
    ],
  },
  {
    slug: 'tv50',
    category: 'tv',
    screenInches: 50,
    baseEur: 449,
    models: ['Novabright 50" 4K LED TV', 'Tidewave 50" 4K HDR TV', 'Kestrel 50" 4K Smart TV'],
  },
  {
    slug: 'tv43',
    category: 'tv',
    screenInches: 43,
    baseEur: 329,
    models: ['Orbis 43" Full HD Smart TV', 'Novabright 43" 4K LED TV', 'Aurora 43" 4K TV'],
  },
  {
    slug: 'soundbar',
    category: 'soundbar',
    baseEur: 199,
    models: ['Tidewave SB-300 Soundbar', 'Kestrel Arc 2.1 Soundbar', 'Orbis Wave Soundbar'],
  },
  {
    slug: 'headphones',
    category: 'headphones',
    baseEur: 249,
    models: ['Quill ANC-700 Headphones', 'Tidewave Silence Pro Headphones', 'Orbis Hush Over-Ear'],
  },
  {
    slug: 'laptop',
    category: 'laptop',
    baseEur: 899,
    models: ['Orbis Book 14 Laptop', 'Kestrel Air 15 Laptop', 'Novabright Flex 13 Laptop'],
  },
  {
    slug: 'tablet',
    category: 'tablet',
    baseEur: 399,
    models: ['Slate 11 Tablet', 'Orbis Tab 10 Tablet', 'Kestrel Pad 12 Tablet'],
  },
];

/** Whole euros ending in 9, near the given amount: 452 → 449, 897 → 899. */
function shelfPrice(euros: number): number {
  return Math.max(9, Math.floor((euros + 5) / 10) * 10 - 1);
}

function planFor(store: StoreSpec, product: ProductSpec, prng: Prng): PricePlan {
  const price = shelfPrice(Math.floor((product.baseEur * prng.int(92, 108)) / 100));
  const pct = prng.int(10, 30);
  const reductionStart = addDays(BLACK_FRIDAY, -prng.int(3, 10));
  const roll = prng.next();
  const realWas = shelfPrice(Math.floor((price * 100) / (100 - pct)));
  const real: PricePlan = { kind: 'real', price, was: realWas, reductionStart, noise: true };
  const none: PricePlan = { kind: 'none', price, noise: true };
  switch (store.practice) {
    case Practice.FakeDiscounts:
      if (roll < 0.6) {
        const was = shelfPrice(Math.floor((price * (100 + pct)) / 100));
        // The raise starts inside the 30-day window, so the old low price is still in it.
        const raiseStart = addDays(reductionStart, -prng.int(12, 24));
        return { kind: 'fake', price, was, raiseStart, reductionStart };
      }
      return roll < 0.8 ? real : none;
    case Practice.Honest:
      return roll < 0.6 ? real : none;
    case Practice.HiddenFee:
    case Practice.Scarcity:
      return roll < 0.5 ? real : none;
  }
}

// --- Dates -----------------------------------------------------------------------------------

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The 60 days of history, ending on Black Friday. */
export function historyDates(): string[] {
  return Array.from({ length: HISTORY_DAYS }, (_, i) =>
    addDays(BLACK_FRIDAY, i - HISTORY_DAYS + 1),
  );
}

// --- Records ---------------------------------------------------------------------------------

const eur = (euros: number): Cents => cents(euros * 100);

function historyFor(plan: PricePlan, prng: Prng): number[] {
  const bump = (euros: number): number => shelfPrice(Math.floor((euros * 105) / 100));
  return historyDates().map((date) => {
    switch (plan.kind) {
      case 'none':
        return plan.noise && prng.chance(0.1) ? bump(plan.price) : plan.price;
      case 'real': {
        if (date >= plan.reductionStart) return plan.price;
        // Noise only goes up, and the day before the cut is pinned to `was`, so `was` stays the
        // lowest price of the 30-day window: the discount is real.
        const lastDayBefore = addDays(plan.reductionStart, -1) === date;
        return plan.noise && !lastDayBefore && prng.chance(0.15) ? bump(plan.was) : plan.was;
      }
      case 'fake':
        if (date >= plan.reductionStart) return plan.price;
        return date >= plan.raiseStart ? plan.was : plan.price;
    }
  });
}

function checkoutLines(store: StoreSpec, price: Cents): CheckoutLine[] {
  const lines: CheckoutLine[] = [
    { kind: CheckoutLineKind.Item, label: 'Item', amount: price },
    { kind: CheckoutLineKind.Shipping, label: 'Free delivery', amount: cents(0) },
  ];
  if (store.practice === Practice.HiddenFee) {
    const fee = price >= eur(400) ? eur(49) : eur(19);
    lines.push({ kind: CheckoutLineKind.ServiceFee, label: 'Service fee', amount: fee });
  }
  return lines;
}

export type Dataset = {
  meta: {
    seed: number;
    blackFriday: string;
    historyDays: number;
    counts: { stores: number; offers: number; priceHistoryRows: number; traps: number };
  };
  demoMandate: Mandate;
  stores: StoreProfile[];
  offers: Offer[];
  priceHistory: PriceHistoryRow[];
  checkouts: CheckoutBreakdown[];
  traps: TrapEntry[];
};

export function generate(seed: number = DEFAULT_SEED): Dataset {
  const prng = createPrng(seed);
  const stores: StoreProfile[] = [];
  const offers: Offer[] = [];
  const priceHistory: PriceHistoryRow[] = [];
  const checkouts: CheckoutBreakdown[] = [];
  const traps: TrapEntry[] = [];
  const dates = historyDates();

  for (const store of STORES) {
    const profile = StoreProfile.parse({
      recordId: `${store.id}-store-sp-1`,
      storeId: store.id,
      name: store.name,
      domainAgeDays: store.domainAgeDays,
      returnPolicy: store.returnPolicy,
      trusted: store.trusted,
    });
    stores.push(profile);

    const demo = DEMO_TVS[store.id];
    const listings = [
      { slug: 'tv55', category: 'tv', screenInches: 55, title: demo.title, plan: demo.plan },
      ...OTHER_PRODUCTS.map((product) => ({
        slug: product.slug,
        category: product.category,
        screenInches: product.screenInches,
        title: prng.pick(product.models),
        plan: planFor(store, product, prng),
      })),
    ];

    const storeOffers: Offer[] = [];
    for (const listing of listings) {
      const offerId = `${store.id}-${listing.slug}`;
      const { plan } = listing;
      const offer = Offer.parse({
        recordId: `${offerId}-of-1`,
        offerId,
        storeId: store.id,
        title:
          store.practice === Practice.Scarcity && listing.slug !== 'tv55'
            ? `MEGA DEAL! ${listing.title}`
            : listing.title,
        category: listing.category,
        screenInches: listing.screenInches,
        price: eur(plan.price),
        wasPrice: plan.kind === 'none' ? undefined : eur(plan.was),
        reductionStart: plan.kind === 'none' ? undefined : plan.reductionStart,
        stockLabel: store.practice === Practice.Scarcity ? 'Only 2 left!' : 'In stock',
      });
      storeOffers.push(offer);

      const rows = historyFor(plan, prng).map((euros, i) =>
        PriceHistoryRow.parse({
          recordId: `${offerId}-ph-${1001 + i}`,
          offerId,
          date: dates[i],
          price: eur(euros),
        }),
      );
      priceHistory.push(...rows);

      const lines = checkoutLines(store, offer.price);
      const checkout = CheckoutBreakdown.parse({
        recordId: `${offerId}-co-1`,
        offerId,
        lines,
        total: sum(
          lines.map((line) => line.amount),
          cents(0),
        ),
      });
      checkouts.push(checkout);

      // --- The answer key. Each trap is planted above; here it is written down. ---
      const trap = (kind: TrapKind, expectedCatcher: Catcher, recordIds: string[]): TrapEntry =>
        TrapEntry.parse({ trap: kind, storeId: store.id, offerId, expectedCatcher, recordIds });

      if (plan.kind === 'fake') {
        // Cite the offer and the days in the 30-day window priced below the "was" price.
        const windowStart = addDays(plan.reductionStart, -OMNIBUS_DAYS);
        const evidence = rows.filter(
          (row) =>
            row.date >= windowStart && row.date < plan.reductionStart && row.price < eur(plan.was),
        );
        traps.push(
          trap(TrapKind.FakeDiscount, Catcher.DealVerifier, [
            offer.recordId,
            ...evidence.map((row) => row.recordId),
          ]),
        );
      }
      if (store.practice === Practice.HiddenFee) {
        traps.push(
          trap(TrapKind.HiddenFee, Catcher.MerchantRisk, [offer.recordId, checkout.recordId]),
        );
      }
      if (store.practice === Practice.Scarcity) {
        traps.push(trap(TrapKind.NoRefundPolicy, Catcher.MerchantRisk, [profile.recordId]));
      }
      const matchesMandate =
        offer.category === DEMO_MANDATE.category &&
        offer.screenInches === DEMO_MANDATE.screenInches;
      if (matchesMandate && checkout.total > DEMO_MANDATE.maxTotal) {
        traps.push(
          trap(TrapKind.OverBudget, Catcher.MandateGuard, [checkout.recordId, MANDATE_RECORD_ID]),
        );
      }
    }
    offers.push(...storeOffers);

    if (store.practice === Practice.Scarcity) {
      // The same "only 2 left!" on every product is the trap; the evidence is all of them.
      const allIds = storeOffers.map((offer) => offer.recordId);
      for (const offer of storeOffers) {
        traps.push(
          TrapEntry.parse({
            trap: TrapKind.FakeScarcity,
            storeId: store.id,
            offerId: offer.offerId,
            expectedCatcher: Catcher.MerchantRisk,
            recordIds: [offer.recordId, ...allIds.filter((id) => id !== offer.recordId)],
          }),
        );
      }
    }
  }

  return {
    meta: {
      seed,
      blackFriday: BLACK_FRIDAY,
      historyDays: HISTORY_DAYS,
      counts: {
        stores: stores.length,
        offers: offers.length,
        priceHistoryRows: priceHistory.length,
        traps: traps.length,
      },
    },
    demoMandate: DEMO_MANDATE,
    stores,
    offers,
    priceHistory,
    checkouts,
    traps,
  };
}
