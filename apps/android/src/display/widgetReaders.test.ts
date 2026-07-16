import { describe, it, expect } from 'vitest';
import { readSystemStats, readWeather, readDeck } from './widgetReaders.js';
import type { Widget } from '@desk-agent/protocol';

describe('readSystemStats', () => {
  it('reads real values when the widget is present', () => {
    const widgets: Record<string, Widget> = {
      w1: {
        type: 'system-stats',
        props: {
          cpuPercent: 42,
          ramPercent: 58,
          battery: '87%',
          nowPlaying: 'Nightcall',
          nowPlayingIsPlaying: true,
          nowPlayingArtwork: 'data:image/jpeg;base64,abc',
        },
      },
    };
    expect(readSystemStats(widgets)).toEqual({
      cpuPercent: 42,
      ramPercent: 58,
      battery: '87%',
      nowPlaying: 'Nightcall',
      nowPlayingIsPlaying: true,
      nowPlayingArtwork: 'data:image/jpeg;base64,abc',
    });
  });

  it('returns honest placeholders when the widget is absent', () => {
    expect(readSystemStats({})).toEqual({
      cpuPercent: null,
      ramPercent: null,
      battery: '—',
      nowPlaying: '—',
      nowPlayingIsPlaying: false,
      nowPlayingArtwork: null,
    });
  });
});

describe('readWeather', () => {
  it('reads real values when the widget is present', () => {
    const widgets: Record<string, Widget> = {
      w1: { type: 'weather', props: { tempF: 68, conditions: 'Cloudy', stale: false } },
    };
    expect(readWeather(widgets)).toEqual({ tempF: 68, conditions: 'Cloudy', stale: false, forecast: [] });
  });

  it('returns honest placeholders when the widget is absent', () => {
    expect(readWeather({})).toEqual({ tempF: null, conditions: '—', stale: true, forecast: [] });
  });

  it('reads a 7-day forecast when present', () => {
    const widgets: Record<string, Widget> = {
      w1: {
        type: 'weather',
        props: {
          tempF: 68,
          conditions: 'Cloudy',
          stale: false,
          forecast: [
            { date: '2026-07-12', tempMaxF: 75, tempMinF: 58, conditions: 'Partly Cloudy' },
            { date: '2026-07-13', tempMaxF: 76, tempMinF: 59, conditions: 'Overcast' },
          ],
        },
      },
    };
    expect(readWeather(widgets).forecast).toEqual([
      { date: '2026-07-12', tempMaxF: 75, tempMinF: 58, conditions: 'Partly Cloudy' },
      { date: '2026-07-13', tempMaxF: 76, tempMinF: 59, conditions: 'Overcast' },
    ]);
  });

  it('drops malformed forecast entries instead of rendering garbage', () => {
    const widgets: Record<string, Widget> = {
      w1: {
        type: 'weather',
        props: {
          tempF: 68,
          conditions: 'Cloudy',
          stale: false,
          forecast: [
            { date: '2026-07-12', tempMaxF: 75, tempMinF: 58, conditions: 'Partly Cloudy' },
            { date: '2026-07-13', tempMaxF: 'not-a-number', tempMinF: 59, conditions: 'Overcast' },
            null,
            'garbage',
          ],
        },
      },
    };
    expect(readWeather(widgets).forecast).toEqual([
      { date: '2026-07-12', tempMaxF: 75, tempMinF: 58, conditions: 'Partly Cloudy' },
    ]);
  });

  it('defaults forecast to an empty array when the field is missing or not an array', () => {
    const widgets: Record<string, Widget> = {
      w1: { type: 'weather', props: { tempF: 68, conditions: 'Cloudy', stale: false, forecast: 'nope' } },
    };
    expect(readWeather(widgets).forecast).toEqual([]);
  });
});

describe('readDeck', () => {
  it('reads buttons, grid, and lastPress when the widget is present', () => {
    const widgets: Record<string, Widget> = {
      w1: {
        type: 'deck',
        props: {
          buttons: [
            { id: 'focus', label: 'Focus', glyph: '◐', color: '#5FD07A', kind: 'shortcut', pluginId: 'focus-mode', action: 'toggle' },
          ],
          grid: { rows: 2, cols: 3 },
          lastPress: { seq: 5, buttonId: 'focus', state: 'ok' },
        },
      },
    };
    expect(readDeck(widgets)).toEqual({
      buttons: [
        { id: 'focus', label: 'Focus', glyph: '◐', color: '#5FD07A', kind: 'shortcut', pluginId: 'focus-mode', action: 'toggle' },
      ],
      grid: { rows: 2, cols: 3 },
      lastPress: { seq: 5, buttonId: 'focus', state: 'ok' },
    });
  });

  it('returns honest placeholders when the widget is absent', () => {
    expect(readDeck({})).toEqual({ buttons: [] });
  });

  it('drops malformed buttons instead of rendering garbage', () => {
    const widgets: Record<string, Widget> = {
      w1: {
        type: 'deck',
        props: {
          buttons: [
            { id: 'focus', label: 'Focus', kind: 'shortcut' },
            { id: 'bad-kind', label: 'Bad', kind: 'nonsense' },
            { label: 'No id', kind: 'shortcut' },
            null,
            'garbage',
          ],
        },
      },
    };
    expect(readDeck(widgets).buttons).toEqual([{ id: 'focus', label: 'Focus', kind: 'shortcut' }]);
  });

  it('omits grid and lastPress when absent instead of fabricating them', () => {
    const widgets: Record<string, Widget> = {
      w1: { type: 'deck', props: { buttons: [] } },
    };
    expect(readDeck(widgets)).toEqual({ buttons: [] });
  });

  it('defaults buttons to an empty array when the field is missing or not an array', () => {
    const widgets: Record<string, Widget> = {
      w1: { type: 'deck', props: { buttons: 'nope' } },
    };
    expect(readDeck(widgets).buttons).toEqual([]);
  });
});
