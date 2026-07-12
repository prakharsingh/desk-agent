import { parentPort, workerData } from 'node:worker_threads';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createEnforcedCtx } from './permissionEnforcer.js';
import type { Ctx, Permission, Plugin } from '@desk-agent/plugin-sdk';

const execFileAsync = promisify(execFile);

const { pluginModulePath, grantedPermissions, pluginConfig } = workerData as {
  pluginModulePath: string;
  grantedPermissions: Permission[];
  pluginConfig?: unknown;
};

async function main() {
  const mod = await import(pluginModulePath);
  // Plugins that need instance config (e.g. weather's location) export a
  // createPlugin(config) factory; plugins that need none export a plain
  // default instance.
  const plugin: Plugin = typeof mod.createPlugin === 'function' ? mod.createPlugin(pluginConfig) : mod.default;

  const baseCtx: Ctx = {
    http: { fetch: (url, init) => fetch(url, init) },
    timer: {
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (handle) => clearInterval(handle),
    },
    log: (level, message) => parentPort!.postMessage({ kind: 'log', level, message }),
    publishEvent: (eventName, data) => parentPort!.postMessage({ kind: 'publishEvent', eventName, data }),
    publishWidget: (widgetId, widget) => parentPort!.postMessage({ kind: 'publishWidget', widgetId, widget }),
    exec: {
      run: async (command, args) => {
        try {
          const { stdout, stderr } = await execFileAsync(command, args);
          return { stdout, stderr, code: 0 };
        } catch (err: any) {
          return { stdout: '', stderr: String(err), code: err.code ?? 1 };
        }
      },
    },
  };

  const ctx = createEnforcedCtx(plugin.id, grantedPermissions, baseCtx, (denial) => {
    parentPort!.postMessage({ kind: 'log', level: 'warn', message: `permission denied: ${JSON.stringify(denial)}` });
  });

  await plugin.init(ctx);

  parentPort!.on('message', async (msg) => {
    try {
      if (msg.kind === 'getWidgets') {
        const widgets = await plugin.getWidgets();
        parentPort!.postMessage({ kind: 'getWidgetsResult', requestId: msg.requestId, widgets });
      } else if (msg.kind === 'onAction') {
        await plugin.onAction(msg.action, msg.args);
      } else if (msg.kind === 'onEvent') {
        await plugin.onEvent(msg.eventName, msg.data);
      }
    } catch (err) {
      parentPort!.postMessage({ kind: 'log', level: 'error', message: `plugin ${plugin.id} handler threw: ${String(err)}` });
    }
  });

  parentPort!.postMessage({ kind: 'ready' });
}

main().catch((err) => {
  parentPort!.postMessage({ kind: 'log', level: 'error', message: `plugin init failed: ${String(err)}` });
  process.exit(1);
});
