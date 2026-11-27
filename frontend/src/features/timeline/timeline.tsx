import type { AgentLane } from '@features/session';
import { cn } from '@lib/cn';

export type TimelineProps = { lanes: AgentLane[]; spanMs: number };

function seconds(ms: number): string {
  return `${Math.round(ms / 1000)} s`;
}

/** One lane per agent on a shared time axis: overlapping scout bars are the concurrency proof. */
export function Timeline({ lanes, spanMs }: TimelineProps) {
  if (lanes.length === 0) return <p className="text-muted">Waiting for the agents to start…</p>;
  const axis = Math.max(spanMs, 1);
  return (
    <figure>
      <ol className="flex flex-col gap-1.5">
        {lanes.map((lane) => {
          const left = (lane.startMs / axis) * 100;
          // A lane with a single event still gets a visible tick.
          const width = Math.max(((lane.endMs - lane.startMs) / axis) * 100, 0.8);
          const scout = lane.agent.startsWith('scout-');
          const state = lane.failure
            ? `failed: ${lane.failure}`
            : lane.running
              ? 'running'
              : 'done';
          return (
            <li key={lane.agent} className="grid grid-cols-[9rem_1fr] items-center gap-2">
              <span className="truncate font-mono text-sm font-semibold">{lane.agent}</span>
              <div className="relative h-6 rounded bg-panel">
                <div
                  className={cn(
                    'absolute inset-y-0 rounded',
                    lane.failure ? 'bg-reject' : scout ? 'bg-accent' : 'bg-muted',
                    lane.running && 'motion-safe:animate-pulse',
                  )}
                  style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
                />
                <span className="sr-only">
                  {`${lane.agent}: from ${seconds(lane.startMs)} to ${seconds(lane.endMs)}, ${state}`}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
      <figcaption className="mt-2 text-sm text-muted">
        Time since the session started, 0 to {seconds(spanMs)}. Bars that overlap ran at the same
        time.
      </figcaption>
    </figure>
  );
}
