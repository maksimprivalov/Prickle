import { OMNIBUS_WINDOW_DAYS } from '@core/deal/omnibus-30-day';
import { EventName, type PrickleEvent } from '@core/events';
import { checkGrounding } from '@core/grounding/check-grounding';
import type { Mandate } from '@core/mandate';
import { MANDATE_RECORD_ID } from '@core/records';
import type { OutputCheck, RecordRegistry } from '@runtime/port';

// Fix 1, wired: the runtime runs this on an agent's parsed answer before anyone sees it. A
// rejected answer is dropped (the loop ends "rejected") and grounding.rejected is published.
//
// Checked: the agents whose words reach the reviewer or the user. Scouts are not, on purpose:
// they name offers by record id only, and resolveMatches() already checks those ids in code.
export const GROUNDED_AGENTS: ReadonlySet<string> = new Set([
  'deal-verifier',
  'merchant-risk',
  'reviewer',
  'budget',
]);

/** The offer an answer is about: the first cited record that names one. */
function offerIdOf(output: unknown, records: RecordRegistry): string | undefined {
  const seen: unknown[] = [output];
  while (seen.length > 0) {
    const value = seen.pop();
    if (typeof value === 'string') {
      const record: unknown = records.get(value);
      if (typeof record === 'object' && record !== null && 'offerId' in record) {
        const { offerId } = record;
        if (typeof offerId === 'string') return offerId;
      }
    } else if (typeof value === 'object' && value !== null) {
      const children: unknown[] = Object.values(value);
      seen.push(...children);
    }
  }
  return undefined;
}

export function createGroundingCheck(options: {
  readonly sessionId: string;
  /** The mandate is a record too: the user's own numbers cite it. */
  readonly mandate: Mandate;
  readonly clock: () => Date;
  readonly publish: (event: PrickleEvent) => void;
}): OutputCheck {
  const mandateRecord = { ...options.mandate, recordId: MANDATE_RECORD_ID };
  return (agent, output, records) => {
    if (!GROUNDED_AGENTS.has(agent.name)) return { ok: true };
    const result = checkGrounding(output, [...records.all(), mandateRecord], {
      // The rule's own number: "the 30 days before the reduction".
      constants: [OMNIBUS_WINDOW_DAYS],
    });
    if (result.ok) return { ok: true };

    const offerId = offerIdOf(output, records);
    options.publish({
      type: EventName.GroundingRejected,
      sessionId: options.sessionId,
      at: options.clock().toISOString(),
      agent: agent.name,
      ...(offerId === undefined ? {} : { offerId }),
      unsourcedNumbers: [...result.unsourced],
    });
    return {
      ok: false,
      detail: `numbers no cited record holds: ${result.unsourced.join(', ')}`,
    };
  };
}
