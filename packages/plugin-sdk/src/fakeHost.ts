import type { Widget } from '@desk-agent/protocol';
import type { Ctx, ExecResult, Permission, Plugin } from './types.js';

export interface FakeHostOptions {
  grantedPermissions?: Permission[];
}

export interface FakeHostRecorder {
  publishedEvents: Array<{ eventName: string; data: Record<string, unknown> }>;
  publishedWidgets: Array<{ widgetId: string; widget: Widget }>;
  logs: Array<{ level: string; message: string }>;
  deniedCalls: string[];
}

export function createFakeHost(plugin: Plugin, options: FakeHostOptions = {}) {
  const granted = new Set(options.grantedPermissions ?? plugin.permissions);
  const recorder: FakeHostRecorder = {
    publishedEvents: [],
    publishedWidgets: [],
    logs: [],
    deniedCalls: [],
  };

  const ctx: Ctx = {
    http: {
      async fetch(url, init) {
        if (!granted.has('net:api.weather')) {
          recorder.deniedCalls.push('http.fetch');
          return new Response(null, { status: 403, statusText: 'permission denied' });
        }
        return fetch(url, init);
      },
    },
    timer: {
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (handle) => clearInterval(handle),
    },
    log: (level, message) => recorder.logs.push({ level, message }),
    publishEvent: (eventName, data) => recorder.publishedEvents.push({ eventName, data }),
    publishWidget: (widgetId, widget) => recorder.publishedWidgets.push({ widgetId, widget }),
    exec: {
      async run(_command, _args): Promise<ExecResult> {
        const hasSysPermission =
          granted.has('sys:read-stats') || granted.has('sys:control-display') || granted.has('sys:control-media');
        if (!hasSysPermission) {
          recorder.deniedCalls.push('exec.run');
          return { stdout: '', stderr: 'permission denied', code: 1 };
        }
        return { stdout: '', stderr: '', code: 0 };
      },
    },
  };

  return {
    ctx,
    recorder,
    async init() {
      await plugin.init(ctx);
    },
    async getWidgets() {
      return await plugin.getWidgets();
    },
    async onAction(action: string, args?: Record<string, unknown>) {
      await plugin.onAction(action, args);
    },
    async onEvent(eventName: string, data: Record<string, unknown>) {
      await plugin.onEvent(eventName, data);
    },
  };
}
