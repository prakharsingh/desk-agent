import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { WeatherDetail } from './WeatherDetail.js';
import { theme } from '../theme.js';
import type { WeatherView } from '../widgetReaders.js';

// Same recursive style search used elsewhere in this pass (Card.test.tsx,
// SystemDetail.test.tsx, HomeScreen.test.tsx).
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

const LIVE_WEATHER: WeatherView = { tempF: 58, conditions: 'Overcast', stale: false, forecast: [] };
const STALE_WEATHER: WeatherView = { ...LIVE_WEATHER, stale: true };

describe('WeatherDetail', () => {
  it('tags live weather data as LIVE via the shared pill-shaped Badge', async () => {
    const { toJSON } = await render(
      <WeatherDetail weather={LIVE_WEATHER} onBack={() => {}} unit="F" onToggleUnit={() => {}} />,
    );
    expect(screen.getByText('LIVE')).toBeTruthy();
    expect(hasStyledNode(toJSON(), 'borderRadius', theme.radii.pill)).toBe(true);
  });

  it('tags stale weather data as STALE via the shared Badge', async () => {
    await render(<WeatherDetail weather={STALE_WEATHER} onBack={() => {}} unit="F" onToggleUnit={() => {}} />);
    expect(screen.getByText('STALE')).toBeTruthy();
  });
});
