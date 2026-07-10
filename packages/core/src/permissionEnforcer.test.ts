import { describe, it, expect, vi } from 'vitest';
import { createEnforcedCtx } from './index.js';
import type { Ctx } from '@desk-agent/plugin-sdk';

function makeBaseCtx(): Ctx {
  return {
    http: { fetch: vi.fn(async () => new Response('ok')) },
    timer: { setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: (h) => clearInterval(h) },
    log: vi.fn(),
    publishEvent: vi.fn(),
    publishWidget: vi.fn(),
    exec: { run: vi.fn(async () => ({ stdout: 'ok', stderr: '', code: 0 })) },
  };
}

describe('createEnforcedCtx', () => {
  it('allows http.fetch when net:api.weather is granted', async () => {
    const base = makeBaseCtx();
    const onDenied = vi.fn();
    const ctx = createEnforcedCtx('weather', ['net:api.weather'], base, onDenied);
    const res = await ctx.http.fetch('https://example.com');
    expect(res.status).not.toBe(403);
    expect(base.http.fetch).toHaveBeenCalled();
    expect(onDenied).not.toHaveBeenCalled();
  });

  it('denies http.fetch when net:api.weather is not granted, without throwing', async () => {
    const base = makeBaseCtx();
    const onDenied = vi.fn();
    const ctx = createEnforcedCtx('system-stats', ['sys:read-stats'], base, onDenied);
    const res = await ctx.http.fetch('https://example.com');
    expect(res.status).toBe(403);
    expect(base.http.fetch).not.toHaveBeenCalled();
    expect(onDenied).toHaveBeenCalledWith({ pluginId: 'system-stats', capability: 'http.fetch', requiredPermission: 'net:api.weather' });
  });

  it('allows exec.run when sys:control-display is granted', async () => {
    const base = makeBaseCtx();
    const ctx = createEnforcedCtx('energy-saver', ['sys:control-display'], base, vi.fn());
    const result = await ctx.exec.run('pmset', ['displaysleepnow']);
    expect(result.code).toBe(0);
  });

  it('denies exec.run when no sys permission is granted, without throwing', async () => {
    const base = makeBaseCtx();
    const onDenied = vi.fn();
    const ctx = createEnforcedCtx('weather', ['net:api.weather'], base, onDenied);
    const result = await ctx.exec.run('pmset', ['displaysleepnow']);
    expect(result.code).toBe(1);
    expect(onDenied).toHaveBeenCalled();
  });

  it('passes timer, log, publishEvent, publishWidget through ungated', () => {
    const base = makeBaseCtx();
    const ctx = createEnforcedCtx('weather', [], base, vi.fn());
    ctx.log('info', 'hi');
    ctx.publishEvent('x', {});
    ctx.publishWidget('w', { type: 't', props: {} });
    expect(base.log).toHaveBeenCalledWith('info', 'hi');
    expect(base.publishEvent).toHaveBeenCalledWith('x', {});
    expect(base.publishWidget).toHaveBeenCalledWith('w', { type: 't', props: {} });
  });
});
