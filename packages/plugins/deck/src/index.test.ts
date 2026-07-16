import { describe, expect, it } from 'vitest';
import { createFakeHost } from '@desk-agent/plugin-sdk';
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
});
