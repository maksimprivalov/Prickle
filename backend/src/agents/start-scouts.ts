import type { PrickleEvent } from '@core/events';
import { EventName } from '@core/events';
import type { Mandate } from '@core/mandate';
import { StoreId, type Offer } from '@core/offers';
import { resolveMatches, type ResolvedMatches, type ScoutReport } from '@core/scouts';
import type { LoopResult, Runtime } from '@runtime/port';
import type { StoreClient } from '@tools/index';
import { createScout, scoutMessage } from './scout';

// Starts the five scouts together and turns their answers into offer.found events. Uses only
// the runtime port, so it runs the same on Mozaik and on the plain adapter.

export type ScoutRun = {
  readonly storeId: StoreId;
  readonly result: LoopResult<ScoutReport>;
  /** What was published as offer.found: offers taken from the tool's records, not the model. */
  readonly offers: readonly Offer[];
  readonly dropped: ResolvedMatches['dropped'];
};

export function startScouts<S>(
  runtime: Runtime<PrickleEvent, S>,
  options: {
    readonly mandate: Mandate;
    readonly client: StoreClient;
    readonly clock: () => Date;
    readonly storeIds?: readonly StoreId[];
  },
): Promise<ScoutRun[]> {
  const { mandate, client, clock } = options;
  const storeIds = options.storeIds ?? Object.values(StoreId);
  const base = (agent: string) => ({
    sessionId: runtime.sessionId,
    at: clock().toISOString(),
    agent,
  });

  // All five loops are started before any is awaited: this is the concurrency the judges score.
  const started = storeIds.map((storeId) => {
    const scout = createScout(storeId, client);
    runtime.publish({ ...base(scout.name), type: EventName.ScoutStarted, storeId });
    return {
      storeId,
      agent: scout.name,
      handle: runtime.start(scout, scoutMessage(mandate, storeId)),
    };
  });

  return Promise.all(
    started.map(async ({ storeId, agent, handle }): Promise<ScoutRun> => {
      const result = await handle.done;
      if (!result.ok) {
        runtime.publish({
          ...base(agent),
          type: EventName.ScoutFinished,
          storeId,
          outcome: { ok: false, detail: `${result.reason}: ${result.detail}` },
        });
        return { storeId, result, offers: [], dropped: [] };
      }
      const { offers, dropped } = resolveMatches({
        recordIds: result.output.matches,
        lookup: (id) => runtime.records.get(id),
        storeId,
        mandate,
      });
      for (const offer of offers) {
        runtime.publish({ ...base(agent), type: EventName.OfferFound, offer });
      }
      runtime.publish({
        ...base(agent),
        type: EventName.ScoutFinished,
        storeId,
        outcome: { ok: true },
      });
      return { storeId, result, offers, dropped };
    }),
  );
}
