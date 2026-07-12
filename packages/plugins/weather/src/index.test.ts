import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFakeHost } from '@desk-agent/plugin-sdk';
import { createWeatherPlugin, describeWeatherCode } from './index.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function geocodeResponse() {
  return new Response(JSON.stringify({ results: [{ latitude: 47.6, longitude: -122.33, name: 'Seattle' }] }));
}

function forecastResponse(overrides: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      current: { temperature_2m: 68, weather_code: 2 },
      daily: {
        time: ['2026-07-12', '2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17', '2026-07-18'],
        temperature_2m_max: [75, 76, 74, 70, 72, 73, 77],
        temperature_2m_min: [58, 59, 57, 55, 56, 58, 60],
        weather_code: [2, 3, 61, 95, 0, 1, 2],
      },
      ...overrides,
    }),
  );
}

function fakeFetch(opts: { geocode?: () => Response; forecast?: () => Response } = {}) {
  return vi.fn(async (url: string) => {
    if (url.includes('geocoding-api')) return opts.geocode ? opts.geocode() : geocodeResponse();
    return opts.forecast ? opts.forecast() : forecastResponse();
  });
}

describe('createWeatherPlugin', () => {
  it('geocodes the configured location, then publishes current conditions plus a 7-day forecast', async () => {
    const plugin = createWeatherPlugin({ location: 'Seattle', intervalMs: 1000 });
    const host = createFakeHost(plugin, { grantedPermissions: ['net:api.weather'] });
    (host.ctx.http.fetch as any) = fakeFetch();
    await plugin.init(host.ctx);
    vi.advanceTimersByTime(1000);
    await vi.waitFor(() => expect(host.recorder.publishedWidgets.length).toBeGreaterThan(0));
    const last = host.recorder.publishedWidgets.at(-1)!;
    expect(last.widget.props).toEqual({
      tempF: 68,
      conditions: 'Partly Cloudy',
      stale: false,
      forecast: [
        { date: '2026-07-12', tempMaxF: 75, tempMinF: 58, conditions: 'Partly Cloudy' },
        { date: '2026-07-13', tempMaxF: 76, tempMinF: 59, conditions: 'Overcast' },
        { date: '2026-07-14', tempMaxF: 74, tempMinF: 57, conditions: 'Slight Rain' },
        { date: '2026-07-15', tempMaxF: 70, tempMinF: 55, conditions: 'Thunderstorm' },
        { date: '2026-07-16', tempMaxF: 72, tempMinF: 56, conditions: 'Clear Sky' },
        { date: '2026-07-17', tempMaxF: 73, tempMinF: 58, conditions: 'Mainly Clear' },
        { date: '2026-07-18', tempMaxF: 77, tempMinF: 60, conditions: 'Partly Cloudy' },
      ],
    });
  });

  it('geocodes the location only once, reusing cached coordinates on later polls', async () => {
    const plugin = createWeatherPlugin({ location: 'Seattle', intervalMs: 1000 });
    const host = createFakeHost(plugin, { grantedPermissions: ['net:api.weather'] });
    const fetchSpy = fakeFetch();
    (host.ctx.http.fetch as any) = fetchSpy;
    await plugin.init(host.ctx);
    vi.advanceTimersByTime(1000);
    await vi.waitFor(() => expect(host.recorder.publishedWidgets.length).toBe(2));
    const geocodeCalls = fetchSpy.mock.calls.filter(([url]) => (url as string).includes('geocoding-api'));
    expect(geocodeCalls).toHaveLength(1);
  });

  it('keeps the last-good reading with stale:true when the forecast fetch fails, never throwing', async () => {
    const plugin = createWeatherPlugin({ location: 'Seattle', intervalMs: 1000 });
    const host = createFakeHost(plugin, { grantedPermissions: ['net:api.weather'] });
    let call = 0;
    (host.ctx.http.fetch as any) = vi.fn(async (url: string) => {
      if (url.includes('geocoding-api')) return geocodeResponse();
      call++;
      if (call === 1) return forecastResponse();
      throw new Error('network down');
    });
    await plugin.init(host.ctx);
    vi.advanceTimersByTime(1000);
    await vi.waitFor(() => expect(host.recorder.publishedWidgets.length).toBe(2));
    const last = host.recorder.publishedWidgets.at(-1)!;
    expect(last.widget.props.stale).toBe(true);
    expect(last.widget.props.tempF).toBe(68);
    expect((last.widget.props.forecast as unknown[])).toHaveLength(7);
  });

  it('reports stale:true with placeholder values and an empty forecast if the very first geocode fails', async () => {
    const plugin = createWeatherPlugin({ location: 'Nowheresville', intervalMs: 1000 });
    const host = createFakeHost(plugin, { grantedPermissions: ['net:api.weather'] });
    (host.ctx.http.fetch as any) = fakeFetch({ geocode: () => new Response(JSON.stringify({ results: [] })) });
    await plugin.init(host.ctx);
    vi.advanceTimersByTime(1000);
    await vi.waitFor(() => expect(host.recorder.publishedWidgets.length).toBe(1));
    const last = host.recorder.publishedWidgets[0];
    expect(last.widget.props).toEqual({ tempF: 0, conditions: 'unknown', forecast: [], stale: true });
  });

  it('retries geocoding on the next poll after an earlier geocode failure', async () => {
    const plugin = createWeatherPlugin({ location: 'Seattle', intervalMs: 1000 });
    const host = createFakeHost(plugin, { grantedPermissions: ['net:api.weather'] });
    let geocodeCall = 0;
    (host.ctx.http.fetch as any) = fakeFetch({
      geocode: () => {
        geocodeCall++;
        return geocodeCall === 1 ? new Response(JSON.stringify({ results: [] })) : geocodeResponse();
      },
    });
    await plugin.init(host.ctx);
    await vi.waitFor(() => expect(host.recorder.publishedWidgets.length).toBe(1));
    expect(host.recorder.publishedWidgets[0].widget.props.stale).toBe(true);
    vi.advanceTimersByTime(1000);
    await vi.waitFor(() => expect(host.recorder.publishedWidgets.length).toBe(2));
    expect(host.recorder.publishedWidgets[1].widget.props.stale).toBe(false);
    expect(geocodeCall).toBe(2);
  });

  it('getWidgets returns stale:true after a successful poll followed by a failed poll', async () => {
    const plugin = createWeatherPlugin({ location: 'Seattle', intervalMs: 1000 });
    const host = createFakeHost(plugin, { grantedPermissions: ['net:api.weather'] });
    let call = 0;
    (host.ctx.http.fetch as any) = vi.fn(async (url: string) => {
      if (url.includes('geocoding-api')) return geocodeResponse();
      call++;
      if (call === 1) return forecastResponse();
      throw new Error('network down');
    });
    await plugin.init(host.ctx);
    await vi.waitFor(() => expect(host.recorder.publishedWidgets.length).toBe(1));
    let widgets = await plugin.getWidgets();
    expect(widgets[0].props.stale).toBe(false);

    vi.advanceTimersByTime(1000);
    await vi.waitFor(() => expect(host.recorder.publishedWidgets.length).toBe(2));
    widgets = await plugin.getWidgets();
    expect(widgets[0].props.stale).toBe(true);
    expect(widgets[0].props.tempF).toBe(68);
  });
});

describe('describeWeatherCode', () => {
  it.each([
    [0, 'Clear Sky'],
    [1, 'Mainly Clear'],
    [2, 'Partly Cloudy'],
    [3, 'Overcast'],
    [45, 'Fog'],
    [61, 'Slight Rain'],
    [71, 'Slight Snow'],
    [95, 'Thunderstorm'],
    [999, 'Unknown'],
  ])('maps WMO code %i to %s', (code, expected) => {
    expect(describeWeatherCode(code)).toBe(expected);
  });
});
