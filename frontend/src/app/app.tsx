import { useState } from 'react';
import type { Mandate } from '@prickle/backend/contracts';
import { Disclaimer } from '@components/disclaimer';
import { startSession } from '@lib/api';
import { MandateFormPanel } from '@features/mandate';
import { useSessionEvents } from '@features/session';
import { SessionPanels } from './session-panels';

// The one page: the mandate form, then the live session drawn from its event stream.
export function App() {
  const [sessionId, setSessionId] = useState<string>();
  const stream = useSessionEvents(sessionId);
  const running = sessionId !== undefined && stream.state !== 'ended' && stream.state !== 'failed';

  async function handleStart(mandate: Mandate) {
    setSessionId(await startSession(mandate));
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 p-4 sm:p-6">
      <header>
        <h1 className="text-4xl font-bold">Prickle</h1>
        <p className="mt-1 text-lg text-muted">
          A team of AI agents shops for you and never spends more than you allowed.
        </p>
      </header>
      <main className="flex flex-col gap-6">
        <MandateFormPanel onStart={handleStart} busy={running} />
        <SessionPanels sessionId={sessionId} stream={stream} />
      </main>
      <footer className="sticky bottom-0 border-t border-line bg-surface py-3">
        <Disclaimer />
      </footer>
    </div>
  );
}
