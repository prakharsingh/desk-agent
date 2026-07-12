import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { Header } from './Header.js';
import { theme } from './theme.js';

const PRESENCE_PRESENT = { label: 'PRESENT' as const, color: theme.colors.accent, note: 'test' };

describe('Header', () => {
  it('renders the connection status label', async () => {
    await render(<Header connectionState="connected" presence={PRESENCE_PRESENT} onSleep={() => {}} />);
    expect(screen.getByText('LIVE')).toBeTruthy();
  });

  it('renders the presence label', async () => {
    await render(<Header connectionState="connected" presence={PRESENCE_PRESENT} onSleep={() => {}} />);
    expect(screen.getByText('PRESENT')).toBeTruthy();
  });

  it('shows LINK DOWN when the connection is lost', async () => {
    await render(<Header connectionState="server-down" presence={PRESENCE_PRESENT} onSleep={() => {}} />);
    expect(screen.getByText('LINK DOWN')).toBeTruthy();
  });

  it('invokes onSleep when the sleep glyph is pressed', async () => {
    const onSleep = jest.fn();
    await render(<Header connectionState="connected" presence={PRESENCE_PRESENT} onSleep={onSleep} />);
    await fireEvent.press(screen.getByText('◑'));
    expect(onSleep).toHaveBeenCalledTimes(1);
  });
});
