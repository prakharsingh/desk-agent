import type { Ctx, Plugin } from '@desk-agent/plugin-sdk';

// Structurally identical to config-schema's DeckButtonConfig -- the registry
// passes the parsed `deck` config block straight through (configKey: 'deck'),
// same pattern as WeatherPluginConfig. Plugins deliberately don't depend on
// @desk-agent/config-schema.
export type DeckButtonPluginConfig =
  | { id: string; label: string; glyph?: string; color?: string; kind: 'shortcut'; shortcutName: string }
  | { id: string; label: string; glyph?: string; color?: string; kind: 'open'; openTarget: string }
  | { id: string; label: string; glyph?: string; color?: string; kind: 'builtin'; pluginId: string; action: string; args?: Record<string, unknown> };

export interface DeckPluginConfig {
  buttons: DeckButtonPluginConfig[];
  grid?: { rows: number; cols: number };
}

interface LastPress {
  seq: number;
  buttonId: string;
  state: 'pending' | 'ok' | 'error';
}

// What crosses the wire per button: display fields plus, for builtin
// buttons only, the phone-routed action target. shortcutName/openTarget
// stay Mac-side -- the phone never needs them.
function toPublishedButton(button: DeckButtonPluginConfig) {
  const base = {
    id: button.id,
    label: button.label,
    kind: button.kind,
    ...(button.glyph !== undefined ? { glyph: button.glyph } : {}),
    ...(button.color !== undefined ? { color: button.color } : {}),
  };
  if (button.kind === 'builtin') {
    return { ...base, pluginId: button.pluginId, action: button.action, ...(button.args ? { args: button.args } : {}) };
  }
  return base;
}

function argvFor(button: DeckButtonPluginConfig): { command: string; args: string[] } | null {
  if (button.kind === 'shortcut') return { command: 'shortcuts', args: ['run', button.shortcutName] };
  if (button.kind === 'open') {
    const isUrl = /^https?:\/\//.test(button.openTarget);
    return { command: 'open', args: isUrl ? [button.openTarget] : ['-a', button.openTarget] };
  }
  return null; // builtin presses are phone-routed and never reach this plugin
}

export function createDeckPlugin(config: DeckPluginConfig): Plugin {
  const buttons = config.buttons.map(toPublishedButton);
  let lastPress: LastPress | undefined;
  let ctxRef: Ctx | null = null;

  function widget() {
    return {
      type: 'deck',
      props: {
        buttons,
        ...(config.grid ? { grid: config.grid } : {}),
        ...(lastPress ? { lastPress } : {}),
      },
    };
  }

  function publish(ctx: Ctx) {
    ctx.publishWidget('deck', widget());
  }

  return {
    id: 'deck',
    permissions: ['sys:run-shortcuts', 'sys:open'],
    init(ctx) {
      ctxRef = ctx;
      publish(ctx);
    },
    // Sync from cache, always: the worker host's 3000ms getWidgets deadline
    // TERMINATES a slow plugin, so this must never await an in-flight exec.
    getWidgets() {
      return [widget()];
    },
    async onAction(action, args) {
      const ctx = ctxRef;
      if (!ctx || action !== 'press') return;
      const buttonId = typeof args?.buttonId === 'string' ? args.buttonId : '';
      const seq = typeof args?.seq === 'number' ? args.seq : -1;
      const receivedAt = Date.now();
      const button = config.buttons.find((candidate) => candidate.id === buttonId);
      const argv = button ? argvFor(button) : null;

      if (!argv) {
        // Unknown id, or a builtin press that should never have been routed
        // here -- ack it as an error rather than silently dropping it.
        // The host doesn't serialize onAction invocations (wsGateway/workerEntry
        // async listeners fire-and-forget), so overlapping presses can settle
        // out of order and race on this module-scoped slot -- only let the
        // newest seq win, so a slow stale ack can never clobber a fresher one.
        if (seq >= (lastPress?.seq ?? -Infinity)) {
          lastPress = { seq, buttonId, state: 'error' };
          publish(ctx);
        }
        ctx.log('warn', `deck press for unknown/non-exec button "${buttonId}"`);
        return;
      }

      // Same newest-seq guard as above: unserialized concurrent onAction
      // calls means seq must gate every lastPress write, not just this one.
      if (seq >= (lastPress?.seq ?? -Infinity)) {
        lastPress = { seq, buttonId, state: 'pending' };
        publish(ctx);
      }
      const result = await ctx.exec.run(argv.command, argv.args);
      // Mac-side latency segment (single clock): action receipt -> exec settled.
      ctx.log('info', `deck press ${buttonId} seq=${seq} exec=${argv.command} code=${result.code} latencyMs=${Date.now() - receivedAt}`);
      if (result.code !== 0) ctx.log('warn', `deck button ${buttonId} failed: ${result.stderr.trim()}`);
      // Newest-seq guard again: a slower exec settling later must not
      // overwrite a newer press's already-published ack.
      if (seq >= (lastPress?.seq ?? -Infinity)) {
        lastPress = { seq, buttonId, state: result.code === 0 ? 'ok' : 'error' };
        publish(ctx);
      }
    },
    onEvent() {},
  };
}

export const createPlugin = createDeckPlugin;
