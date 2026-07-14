import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { StandbyScreen } from './StandbyScreen.js';
import { theme } from '../theme.js';
import { STANDBY_VOICE } from '../screens.js';

function hasStyledNode(node: any, prop: string, value: unknown): boolean {
  if (!node) return false;
  const styles = Array.isArray(node.props?.style) ? node.props.style.flat(Infinity) : [node.props?.style];
  if (styles.some((s: any) => s && s[prop] === value)) return true;
  const children = node.children;
  if (Array.isArray(children)) {
    return children.some((c: any) => hasStyledNode(c, prop, value));
  }
  return false;
}

describe('StandbyScreen', () => {
  it('keeps the honest "not connected" copy and the ON THE ROADMAP badge', async () => {
    await render(<StandbyScreen standby={STANDBY_VOICE} onBack={() => {}} />);
    expect(screen.getByText('MODULE NOT CONNECTED')).toBeTruthy();
    expect(screen.getByText('ON THE ROADMAP')).toBeTruthy();
  });

  it('renders the roadmap tag as the shared pill-shaped Badge', async () => {
    const { toJSON } = await render(<StandbyScreen standby={STANDBY_VOICE} onBack={() => {}} />);
    expect(hasStyledNode(toJSON(), 'borderRadius', theme.radii.pill)).toBe(true);
  });
});
