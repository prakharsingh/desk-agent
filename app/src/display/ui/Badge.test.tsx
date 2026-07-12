import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { Badge } from './Badge.js';

describe('Badge', () => {
  it('renders the given label text', async () => {
    await render(<Badge label="LIVE" tone="live" />);
    expect(screen.getByText('LIVE')).toBeTruthy();
  });

  it('renders without crashing for every tone', async () => {
    const tones = ['live', 'stale', 'warn', 'neutral'] as const;
    for (const tone of tones) {
      await render(<Badge label={`TONE-${tone}`} tone={tone} />);
      expect(screen.getByText(`TONE-${tone}`)).toBeTruthy();
    }
  });
});
