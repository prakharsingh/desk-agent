import React from 'react';
import { render } from '@testing-library/react-native';
import { IconChip } from './IconChip.js';

describe('IconChip', () => {
  it('renders the accent tone without crashing', async () => {
    await render(<IconChip kind="clock" tone="accent" />);
  });

  it('renders the dim tone (for roadmap cards) without crashing', async () => {
    await render(<IconChip kind="voice" tone="dim" />);
  });

  it('renders every section icon kind without crashing', async () => {
    const kinds = ['clock', 'system', 'presence', 'playing', 'voice', 'deck', 'light'] as const;
    for (const kind of kinds) {
      await render(<IconChip kind={kind} />);
    }
  });
});
