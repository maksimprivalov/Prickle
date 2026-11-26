import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './app';

describe('App', () => {
  it('shows the not-financial-advice disclaimer', () => {
    render(<App />);
    expect(screen.getByText('Not financial advice.')).toBeInTheDocument();
  });
});
