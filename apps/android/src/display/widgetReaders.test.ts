import { describe, it, expect } from 'vitest';
import { readSystemStats, readWeather } from './widgetReaders.js';
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
