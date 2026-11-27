import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import type { Mandate } from '@prickle/backend/contracts';
import { startSession } from '@lib/api';
import { server, setupMswServer } from '@test/msw';
import { MandateFormPanel } from './mandate-form';

setupMswServer();

async function startForReal(mandate: Mandate): Promise<void> {
  await startSession(mandate);
}

function renderForm(onStart: (mandate: Mandate) => Promise<void> = startForReal) {
  render(<MandateFormPanel onStart={onStart} busy={false} />);
  return userEvent.setup();
}

describe('MandateFormPanel', () => {
  it('posts the demo mandate with the maximum in integer cents', async () => {
    let body: unknown;
    server.use(
      http.post('/api/sessions', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ sessionId: 's-1' }, { status: 201 });
      }),
    );
    const user = renderForm();
    const max = screen.getByLabelText('Maximum total at checkout (EUR)');
    await user.clear(max);
    await user.type(max, '599,99');
    await user.click(screen.getByRole('button', { name: 'Shop for me' }));
    await vi.waitFor(() =>
      expect(body).toEqual({
        description: '55-inch TV',
        category: 'tv',
        screenInches: 55,
        maxTotal: 59999,
        requireRealDiscount: true,
        trustedStoresOnly: true,
      }),
    );
  });

  it('explains an invalid amount next to the field and does not submit', async () => {
    const onStart = vi.fn(() => Promise.resolve());
    const user = renderForm(onStart);
    const max = screen.getByLabelText('Maximum total at checkout (EUR)');
    await user.clear(max);
    await user.type(max, 'lots');
    await user.click(screen.getByRole('button', { name: 'Shop for me' }));
    expect(await screen.findByText(/Enter an amount in euros above zero/)).toBeInTheDocument();
    expect(max).toHaveAttribute('aria-invalid', 'true');
    expect(max).toHaveFocus();
    expect(onStart).not.toHaveBeenCalled();
  });

  it('shows the server error near the button when a session is already running', async () => {
    server.use(
      http.post('/api/sessions', () =>
        HttpResponse.json(
          { error: 'A session is already running; try again when it has ended.' },
          { status: 409 },
        ),
      ),
    );
    const user = renderForm();
    await user.click(screen.getByRole('button', { name: 'Shop for me' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A session is already running');
  });

  it('disables submit while the session is starting and says why', async () => {
    let release = () => undefined as void;
    const onStart = () => new Promise<void>((resolve) => (release = resolve));
    const user = renderForm(onStart);
    await user.click(screen.getByRole('button', { name: 'Shop for me' }));
    expect(await screen.findByText('Starting…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Shop for me' })).toBeDisabled();
    release();
  });
});
