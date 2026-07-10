import { describe, it, expect } from 'vitest';
import type { Plugin, Ctx } from './index.js';

function makeNoopCtx(): Ctx {
  return {
    http: { fetch: async () => new Response(null) },
    timer: { setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: (h) => clearInterval(h) },
    log: () => {},
    publishEvent: () => {},
    publishWidget: () => {},
    exec: { run: async () => ({ stdout: '', stderr: '', code: 0 }) },
  };
}

describe('Plugin contract', () => {
  it('a minimal plugin satisfies the Plugin interface and can be driven directly', async () => {
    const plugin: Plugin = {
      id: 'noop',
      permissions: [],
      init: async () => {},
      getWidgets: () => [{ type: 'noop', props: {} }],
      onAction: async () => {},
      onEvent: async () => {},
    };
    const ctx = makeNoopCtx();
    await plugin.init(ctx);
    const widgets = await plugin.getWidgets();
    expect(widgets).toEqual([{ type: 'noop', props: {} }]);
  });
});
