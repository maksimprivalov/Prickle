import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import evalRun from '@test/fixtures/eval-scripted-run.jsonl?raw';
import sampleRun from '@test/fixtures/sample-run.jsonl?raw';
import { replay, runLogMessages } from '@test/run-log';
import { SessionPanels } from './session-panels';

// The panels are drawn from the recorded run as the stream hook would hold it. (Streaming it
// through MSW's sse() is not possible here: jsdom has no EventSource, and Node's clashes with
// jsdom's Event class. The parse and dedupe path is covered in features/session/stream.test.ts.)

describe('SessionPanels on the recorded demo run', () => {
  const stream = replay(runLogMessages(sampleRun));

  it('shows the guard decision and the spend report with sources', () => {
    render(<SessionPanels sessionId="demo" stream={stream} />);
    expect(screen.getByText('Allowed')).toBeInTheDocument();
    const report = screen.getByRole('region', { name: 'Spend report' });
    expect(within(report).getAllByText('585 test USDC')).toHaveLength(2);
    expect(within(report).getByText('600 test USDC')).toBeInTheDocument();
    expect(
      within(report).getAllByRole('note', { name: 'Source: record b-tv55-pay-1' }),
    ).toHaveLength(3);
    expect(within(report).getByText(/Mock payment/)).toBeInTheDocument();
    expect(within(report).queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows every offer with its price, its source and the reviewer decision in words', () => {
    render(<SessionPanels sessionId="demo" stream={stream} />);
    const offers = screen.getAllByRole('article');
    expect(offers).toHaveLength(4);
    const storeB = screen.getByRole('article', { name: /^Kestrel 55/ });
    expect(within(storeB).getAllByText('Passed').length).toBeGreaterThan(0);
    expect(within(storeB).getByText('585.00 EUR')).toBeInTheDocument();
    expect(screen.getAllByText('Passed').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Rejected').length).toBeGreaterThan(0);
    expect(screen.getByText('585.00 EUR')).toBeInTheDocument();
    expect(
      screen.getAllByRole('note', { name: 'Source: record b-tv55-of-1' }).length,
    ).toBeGreaterThan(0);
  });

  it('draws a lane for each of the five scouts', () => {
    render(<SessionPanels sessionId="demo" stream={stream} />);
    for (const store of ['a', 'b', 'c', 'd', 'e']) {
      expect(screen.getByText(new RegExp(`^scout-${store}: from`))).toBeInTheDocument();
    }
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <main>
        <SessionPanels sessionId="demo" stream={stream} />
      </main>,
    );
    expect((await axe(container)).violations).toEqual([]);
  });
});

describe('SessionPanels on the recorded eval run', () => {
  it('lists a deny with every reason and the values it compared', () => {
    render(<SessionPanels sessionId="eval" stream={replay(runLogMessages(evalRun))} />);
    expect(screen.getAllByText('Denied').length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("The checkout total €749.00 is over the mandate's €600.00.").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole('note', { name: 'Source: record a-tv55-co-1' }).length,
    ).toBeGreaterThan(0);
  });
});
