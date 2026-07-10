import { describe, it, expect } from 'vitest';
import { createFakeHost } from './index.js';
import type { Plugin } from './index.js';

function makeChattyPlugin(): Plugin {
  return {
    id: 'chatty',
    permissions: ['net:api.weather'],
    init: async () => {},
    getWidgets: () => [],
    onAction: async () => {},
    onEvent: async (eventName, data) => {},
  };
}

describe('createFakeHost', () => {
  it('records events published via ctx.publishEvent', async () => {
    const plugin: Plugin = {
      ...makeChattyPlugin(),
      init: async (ctx) => ctx.publishEvent('ping', { n: 1 }),
    };
    const host = createFakeHost(plugin);
    await host.init();
    expect(host.recorder.publishedEvents).toEqual([{ eventName: 'ping', data: { n: 1 } }]);
  });

  it('records widgets published via ctx.publishWidget', async () => {
    const plugin: Plugin = {
      ...makeChattyPlugin(),
      init: async (ctx) => ctx.publishWidget('w1', { type: 'noop', props: {} }),
    };
    const host = createFakeHost(plugin);
    await host.init();
    expect(host.recorder.publishedWidgets).toEqual([{ widgetId: 'w1', widget: { type: 'noop', props: {} } }]);
  });

  it('denies http.fetch when net:api.weather is not granted', async () => {
    const plugin: Plugin = {
      ...makeChattyPlugin(),
      permissions: [],
      init: async (ctx) => { await ctx.http.fetch('https://example.com'); },
    };
    const host = createFakeHost(plugin, { grantedPermissions: [] });
    await host.init();
    expect(host.recorder.deniedCalls).toContain('http.fetch');
  });

  it('denies exec.run when sys permissions are not granted', async () => {
    const plugin: Plugin = {
      ...makeChattyPlugin(),
      permissions: [],
      init: async (ctx) => { await ctx.exec.run('echo', ['hi']); },
    };
    const host = createFakeHost(plugin, { grantedPermissions: [] });
    await host.init();
    expect(host.recorder.deniedCalls).toContain('exec.run');
  });
});
