import { milestones, reduceEvents, StreamState, type StreamModel } from '@features/session';
import { OffersList } from '@features/offers';
import { SpendPanel } from '@features/spend';
import { Timeline } from '@features/timeline';

export type SessionPanelsProps = { sessionId: string | undefined; stream: StreamModel };

const streamLabel: Record<StreamState, string> = {
  idle: 'Not started',
  connecting: 'Connecting…',
  open: 'Streaming',
  reconnecting: 'Connection lost, reconnecting…',
  ended: 'Session ended',
  failed: 'The event stream failed. Is `pnpm dev` running in backend/?',
};

export function SessionPanels({ sessionId, stream }: SessionPanelsProps) {
  const view = reduceEvents(stream.events);
  const announcements = milestones(view);
  const running = stream.state !== StreamState.Ended && stream.state !== StreamState.Failed;

  return (
    <>
      {/* Present from the start so screen readers pick up the first milestone. */}
      <p aria-live="polite" className="sr-only">
        {announcements.at(-1) ?? ''}
      </p>
      {sessionId && (
        <>
          <p className="text-muted">
            Session <span className="font-mono">{sessionId}</span>: {streamLabel[stream.state]}
          </p>
          <section aria-labelledby="timeline-heading" className="rounded-lg border border-line p-4">
            <h2 id="timeline-heading" className="text-xl font-bold">
              Agents at work
            </h2>
            <div className="mt-3">
              <Timeline lanes={view.lanes} spanMs={view.spanMs} />
            </div>
          </section>
          <section aria-labelledby="offers-heading">
            <h2 id="offers-heading" className="text-xl font-bold">
              Offers
            </h2>
            <div className="mt-3">
              <OffersList offers={view.offers} running={running} />
            </div>
          </section>
          <section aria-labelledby="spend-heading" className="rounded-lg border-2 border-line p-4">
            <h2 id="spend-heading" className="text-2xl font-bold">
              Decision and spend
            </h2>
            <div className="mt-3">
              <SpendPanel view={view} />
            </div>
          </section>
        </>
      )}
    </>
  );
}
