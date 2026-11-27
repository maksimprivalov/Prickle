import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NOT_FINANCIAL_ADVICE } from '@prickle/backend/contracts';
import { App } from './app';

describe('App', () => {
  it('shows the not-financial-advice disclaimer', () => {
    render(<App />);
    expect(screen.getByText(NOT_FINANCIAL_ADVICE)).toBeInTheDocument();
    expect(screen.getByText(/Not financial advice\./)).toBeInTheDocument();
  });

  it('starts with the demo mandate filled in', () => {
    render(<App />);
    expect(screen.getByLabelText('What to buy')).toHaveValue('55-inch TV');
    expect(screen.getByLabelText('Maximum total at checkout (EUR)')).toHaveValue('600');
  });
});
