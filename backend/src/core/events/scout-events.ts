import { z } from 'zod';
import { Offer } from '../offers/offer';
import { StoreIdSchema } from '../offers/store-id';
import { eventBase } from './event-base';
import { EventName } from './event-name';

// Scout events are the concurrency proof on screen: five started, offers interleaved, five
// finished.

export const ScoutStarted = z.object({
  ...eventBase,
  type: z.literal(EventName.ScoutStarted),
  storeId: StoreIdSchema,
});
export type ScoutStarted = z.infer<typeof ScoutStarted>;

/** One offer matching the mandate. The deal verifier and merchant risk react to it. */
export const OfferFound = z.object({
  ...eventBase,
  type: z.literal(EventName.OfferFound),
  offer: Offer,
});
export type OfferFound = z.infer<typeof OfferFound>;

export const ScoutFinished = z.object({
  ...eventBase,
  type: z.literal(EventName.ScoutFinished),
  storeId: StoreIdSchema,
  outcome: z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true) }),
    z.object({ ok: z.literal(false), detail: z.string().min(1) }),
  ]),
});
export type ScoutFinished = z.infer<typeof ScoutFinished>;
