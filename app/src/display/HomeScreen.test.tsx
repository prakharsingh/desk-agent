import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { HomeScreen } from './HomeScreen.js';
import { theme } from './theme.js';
import type { SystemStatsView, WeatherView } from './widgetReaders.js';
import type { PresenceView } from './derivePresence.js';

// Same recursive style search used by Card.test.tsx / SystemDetail.test.tsx.
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

const STATS: SystemStatsView = {
  cpuPercent: 24,
  ramPercent: 61,
  battery: 'N/A',
  nowPlaying: '—',
  nowPlayingIsPlaying: false,
  nowPlayingArtwork: null,
};

const HIGH_RAM: SystemStatsView = { ...STATS, ramPercent: 99 };

const LIVE_WEATHER: WeatherView = { tempF: 58, conditions: 'Overcast', stale: false, forecast: [] };
const STALE_WEATHER: WeatherView = { ...LIVE_WEATHER, stale: true };

const PRESENCE: PresenceView = { label: 'UNKNOWN', color: theme.colors.textFaint, note: 'test' };

const NOOP = () => {};
const BASE_PROPS = {
  weather: LIVE_WEATHER,
  presence: PRESENCE,
  now: 0,
  startedAt: 0,
  cpuHistory: [] as number[],
  ramHistory: [] as number[],
  unit: 'F' as const,
  onGoSystem: NOOP,
  onGoWeather: NOOP,
  onGoPlaying: NOOP,
  onGoPresence: NOOP,
  onGoClock: NOOP,
  onGoVoice: NOOP,
  onGoDeck: NOOP,
  onGoLight: NOOP,
};

describe('HomeScreen', () => {
  it('shows the honest AC-power label instead of the raw N/A battery sentinel', async () => {
    await render(<HomeScreen {...BASE_PROPS} stats={STATS} />);
    expect(screen.getByText('AC · DOCKED')).toBeTruthy();
    expect(screen.queryByText('N/A')).toBeNull();
  });

  it('shows "Idle" instead of the raw wire sentinel for the Now Playing tile', async () => {
    await render(<HomeScreen {...BASE_PROPS} stats={STATS} />);
    expect(screen.getByText('Idle')).toBeTruthy();
  });

  it('shows the real track name when one is playing', async () => {
    await render(<HomeScreen {...BASE_PROPS} stats={{ ...STATS, nowPlaying: 'Comfortably Numb' }} />);
    expect(screen.getByText('Comfortably Numb')).toBeTruthy();
    expect(screen.queryByText('Idle')).toBeNull();
  });

  it('tags live weather data as LIVE and stale data as STALE', async () => {
    await render(<HomeScreen {...BASE_PROPS} weather={LIVE_WEATHER} stats={STATS} />);
    expect(screen.getByText('LIVE')).toBeTruthy();

    await render(<HomeScreen {...BASE_PROPS} weather={STALE_WEATHER} stats={STATS} />);
    expect(screen.getByText('STALE')).toBeTruthy();
  });

  it('tints a >=90% load metric amber, not its normal color', async () => {
    const { toJSON } = await render(<HomeScreen {...BASE_PROPS} stats={HIGH_RAM} />);
    expect(hasStyledNode(toJSON(), 'backgroundColor', theme.colors.warn)).toBe(true);
  });

  it('renders Voice and Steam Deck as roadmap cards with honest, unfabricated copy', async () => {
    await render(<HomeScreen {...BASE_PROPS} stats={STATS} />);
    expect(screen.getAllByText('ROADMAP').length).toBeGreaterThan(0);
    expect(screen.getByText('MODULE STANDBY')).toBeTruthy();
    expect(screen.getByText('NOT LINKED')).toBeTruthy();
  });

  it('gives the roadmap cards a dashed border, distinct from the real module cards', async () => {
    const { toJSON } = await render(<HomeScreen {...BASE_PROPS} stats={STATS} />);
    expect(hasStyledNode(toJSON(), 'borderStyle', 'dashed')).toBe(true);
  });

  describe('visibleWidgets (Phase 4: Widgets pane)', () => {
    it('shows every real tile when visibleWidgets is omitted -- fail open, not fail hidden, before the first hello reply', async () => {
      await render(<HomeScreen {...BASE_PROPS} stats={STATS} />);
      expect(screen.getByText('CLOCK')).toBeTruthy();
      expect(screen.getByText('SYSTEM')).toBeTruthy();
      expect(screen.getByText('WEATHER')).toBeTruthy();
      expect(screen.getByText('NOW PLAYING')).toBeTruthy();
      expect(screen.getByText('CHIN LIGHT')).toBeTruthy();
    });

    it('hides a tile whose id is absent from visibleWidgets', async () => {
      await render(<HomeScreen {...BASE_PROPS} stats={STATS} visibleWidgets={['clock', 'system', 'presence', 'playing', 'light']} />);
      expect(screen.getByText('CLOCK')).toBeTruthy();
      expect(screen.queryByText('WEATHER')).toBeNull();
    });

    it('shows only the tiles present in visibleWidgets, hiding the rest', async () => {
      await render(<HomeScreen {...BASE_PROPS} stats={STATS} visibleWidgets={['clock']} />);
      expect(screen.getByText('CLOCK')).toBeTruthy();
      expect(screen.queryByText('SYSTEM')).toBeNull();
      expect(screen.queryByText('WEATHER')).toBeNull();
      expect(screen.queryByText('NOW PLAYING')).toBeNull();
      expect(screen.queryByText('CHIN LIGHT')).toBeNull();
    });

    it('never hides the roadmap tiles (Voice, Steam Deck) -- they are not in WIDGET_IDS and are never toggleable', async () => {
      await render(<HomeScreen {...BASE_PROPS} stats={STATS} visibleWidgets={['clock']} />);
      expect(screen.getAllByText('ROADMAP').length).toBeGreaterThan(0);
    });
  });
});
