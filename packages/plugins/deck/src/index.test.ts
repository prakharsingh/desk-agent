import { describe, expect, it } from 'vitest';
import { createFakeHost } from '@desk-agent/plugin-sdk';
import type { Ctx, ExecResult } from '@desk-agent/plugin-sdk';
import type { Widget } from '@desk-agent/protocol';
import { createDeckPlugin, type DeckPluginConfig } from './index.js';

const CONFIG: DeckPluginConfig = {
  buttons: [
    { id: 'focus', label: 'Focus Mode', kind: 'shortcut', shortcutName: 'Focus Mode' },
    { id: 'figma', label: 'Open Figma', kind: 'open', openTarget: 'Figma' },
    { id: 'site', label: 'Dashboard', kind: 'open', openTarget: 'https://example.com' },
    { id: 'sleep', label: 'Sleep', kind: 'builtin', pluginId: 'energy-saver', action: 'sleep-display' },
  ],
};

function lastPublished(host: ReturnType<typeof createFakeHost>) {
  const entries = host.recorder.publishedWidgets;
  return entries[entries.length - 1]!.widget;
}

describe('deck plugin', () => {
  it('publishes the button grid on init, without exec-only fields', async () => {
    const host = createFakeHost(createDeckPlugin(CONFIG));
    await host.init();
    const widget = lastPublished(host);
    expect(widget.type).toBe('deck');
    const buttons = widget.props.buttons as Array<Record<string, unknown>>;
    expect(buttons.map((b) => b.id)).toEqual(['focus', 'figma', 'site', 'sleep']);
    expect(buttons[0]).not.toHaveProperty('shortcutName');
    expect(buttons[3]).toMatchObject({ pluginId: 'energy-saver', action: 'sleep-display' });
  });

  it('getWidgets returns cached state synchronously', async () => {
    const plugin = createDeckPlugin(CONFIG);
    const host = createFakeHost(plugin);
    await host.init();
    const widgets = plugin.getWidgets();
    expect(Array.isArray(widgets)).toBe(true); // sync return, not a Promise
  });

  it('press on a shortcut button acks pending then ok, and runs `shortcuts run`', async () => {
    const host = createFakeHost(createDeckPlugin(CONFIG));
    await host.init();
    await host.onAction('press', { buttonId: 'focus', seq: 7 });
    expect(host.recorder.execCalls).toContainEqual({ command: 'shortcuts', args: ['run', 'Focus Mode'] });
    const states = host.recorder.publishedWidgets
      .map((entry) => (entry.widget.props.lastPress as { seq: number; state: string } | undefined))
      .filter((lp) => lp?.seq === 7)
      .map((lp) => lp!.state);
    expect(states).toEqual(['pending', 'ok']);
  });

  it('open buttons map app names to `open -a` and URLs to bare `open`', async () => {
    const host = createFakeHost(createDeckPlugin(CONFIG));
    await host.init();
    await host.onAction('press', { buttonId: 'figma', seq: 1 });
    await host.onAction('press', { buttonId: 'site', seq: 2 });
    expect(host.recorder.execCalls).toContainEqual({ command: 'open', args: ['-a', 'Figma'] });
    expect(host.recorder.execCalls).toContainEqual({ command: 'open', args: ['https://example.com'] });
  });

  it('acks error when exec fails, and for unknown/builtin buttonIds', async () => {
    const host = createFakeHost(createDeckPlugin(CONFIG), { grantedPermissions: [] }); // every exec denied -> code 1
    await host.init();
    await host.onAction('press', { buttonId: 'focus', seq: 3 });
    const last = lastPublished(host).props.lastPress as { seq: number; state: string };
    expect(last).toEqual({ seq: 3, buttonId: 'focus', state: 'error' });
  });

  it('newest seq wins when an interleaved press settles after a later one (task-4 regression)', async () => {
    // The host doesn't serialize onAction invocations, so two overlapping
    // presses can have their execs settle out of order. Build a minimal Ctx
    // (not the fakeHost, which resolves exec.run immediately) with a
    // controllable deferred per exec.run call so we can force press A (seq 1)
    // to settle AFTER press B (seq 2).
    const published: Array<{ widgetId: string; widget: Widget }> = [];
    const resolvers: Array<(result: ExecResult) => void> = [];

    const ctx: Ctx = {
      http: {
        async fetch() {
          throw new Error('unused in this test');
        },
      },
      timer: {
        setInterval: (fn, ms) => setInterval(fn, ms),
        clearInterval: (handle) => clearInterval(handle),
      },
      log: () => {},
      publishEvent: () => {},
      publishWidget: (widgetId, widget) => published.push({ widgetId, widget }),
      exec: {
        run() {
          return new Promise<ExecResult>((resolve) => {
            resolvers.push(resolve);
          });
        },
      },
    };

    const plugin = createDeckPlugin(CONFIG);
    await plugin.init(ctx);
    published.length = 0; // drop the init publish, only interleaved-press publishes matter below

    // Fire both presses without awaiting -- each runs synchronously up to its
    // `await ctx.exec.run(...)`, so both deferred resolvers are queued before
    // either settles.
    const pressA = plugin.onAction('press', { buttonId: 'focus', seq: 1 });
    const pressB = plugin.onAction('press', { buttonId: 'figma', seq: 2 });
    expect(resolvers).toHaveLength(2);

    // B (seq 2, the fast press) settles first...
    resolvers[1]!({ stdout: '', stderr: '', code: 0 });
    await pressB;
    const indexAfterBSettled = published.length;

    // ...then the stale A (seq 1) settles after. Without the newest-seq guard
    // this would overwrite lastPress back down to seq 1.
    resolvers[0]!({ stdout: '', stderr: '', code: 0 });
    await pressA;

    const finalLastPress = published[published.length - 1]!.widget.props.lastPress as { seq: number };
    expect(finalLastPress.seq).toBe(2);

    // No publish after B's settled ack may carry the stale seq 1.
    const staleSeqOnePublishesAfterB = published
      .slice(indexAfterBSettled)
      .filter((entry) => (entry.widget.props.lastPress as { seq: number } | undefined)?.seq === 1);
    expect(staleSeqOnePublishesAfterB).toEqual([]);
  });
});
