import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFakeHost } from '@desk-agent/plugin-sdk';
import { createWeatherPlugin } from './index.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createWeatherPlugin', () => {
  it('publishes a weather widget from a successful fetch', async () => {
    const plugin = createWeatherPlugin({ apiKey: 'k', location: 'Seattle', intervalMs: 1000 });
    const host = createFakeHost(plugin, { grantedPermissions: ['net:api.weather'] });
    (host.ctx.http.fetch as any) = vi.fn(async () => new Response(JSON.stringify({ tempF: 68, conditions: 'Cloudy' })));
    await plugin.init(host.ctx);
    vi.advanceTimersByTime(1000);
    await vi.waitFor(() => expect(host.recorder.publishedWidgets.length).toBeGreaterThan(0));
    const last = host.recorder.publishedWidgets.at(-1)!;
    expect(last.widget.props).toEqual({ tempF: 68, conditions: 'Cloudy', stale: false });
  });

  it('keeps the last-good value with stale:true on fetch failure, never throwing', async () => {
    const plugin = createWeatherPlugin({ apiKey: 'k', location: 'Seattle', intervalMs: 1000 });
    const host = createFakeHost(plugin, { grantedPermissions: ['net:api.weather'] });
    let call = 0;
    (host.ctx.http.fetch as any) = vi.fn(async () => {
      call++;
      if (call === 1) return new Response(JSON.stringify({ tempF: 68, conditions: 'Cloudy' }));
      throw new Error('network down');
    });
    await plugin.init(host.ctx);
    vi.advanceTimersByTime(1000);
    await vi.waitFor(() => expect(host.recorder.publishedWidgets.length).toBe(1));
    vi.advanceTimersByTime(1000);
    await vi.waitFor(() => expect(host.recorder.publishedWidgets.length).toBe(2));
    const last = host.recorder.publishedWidgets.at(-1)!;
    expect(last.widget.props).toEqual({ tempF: 68, conditions: 'Cloudy', stale: true });
  });

  it('reports stale:true with placeholder values if the very first fetch fails', async () => {
    const plugin = createWeatherPlugin({ apiKey: 'k', location: 'Seattle', intervalMs: 1000 });
    const host = createFakeHost(plugin, { grantedPermissions: ['net:api.weather'] });
    (host.ctx.http.fetch as any) = vi.fn(async () => { throw new Error('network down'); });
    await plugin.init(host.ctx);
    vi.advanceTimersByTime(1000);
    await vi.waitFor(() => expect(host.recorder.publishedWidgets.length).toBe(1));
    expect(host.recorder.publishedWidgets[0].widget.props.stale).toBe(true);
  });

  it('getWidgets returns stale:true after a successful poll followed by a failed poll', async () => {
    const plugin = createWeatherPlugin({ apiKey: 'k', location: 'Seattle', intervalMs: 1000 });
    const host = createFakeHost(plugin, { grantedPermissions: ['net:api.weather'] });
    let call = 0;
    (host.ctx.http.fetch as any) = vi.fn(async () => {
      call++;
      if (call === 1) return new Response(JSON.stringify({ tempF: 68, conditions: 'Cloudy' }));
      throw new Error('network down');
    });
    // First init/poll succeeds
    await plugin.init(host.ctx);
    // Give the poll promise time to settle
    await vi.waitFor(() => expect(host.recorder.publishedWidgets.length).toBe(1));
    // First poll succeeded, so getWidgets should reflect fresh data with stale: false
    let widgets = await plugin.getWidgets();
    expect(widgets[0].props.stale).toBe(false);
    expect(widgets[0].props).toEqual({ tempF: 68, conditions: 'Cloudy', stale: false });

    // Advance time to trigger second poll which will fail
    vi.advanceTimersByTime(1000);
    await vi.waitFor(() => expect(host.recorder.publishedWidgets.length).toBe(2));
    // Second poll failed, so getWidgets should now reflect stale state
    widgets = await plugin.getWidgets();
    expect(widgets[0].props.stale).toBe(true);
    // The data should still be the last good value but marked stale
    expect(widgets[0].props).toEqual({ tempF: 68, conditions: 'Cloudy', stale: true });
  });
});
