import type { Ctx, Plugin } from '@desk-agent/plugin-sdk';

let capturedCtx: Ctx | null = null;

const energySaverPlugin: Plugin = {
  id: 'energy-saver',
  permissions: ['sys:control-display'],
  init(ctx) {
    capturedCtx = ctx;
  },
  getWidgets() {
    return [];
  },
  async onAction(action) {
    if (action === 'sleep-display') {
      if (!capturedCtx) return;
      try {
        const result = await capturedCtx.exec.run('pmset', ['displaysleepnow']);
        if (result.code !== 0) {
          capturedCtx.log('error', `pmset displaysleepnow failed: ${result.stderr}`);
        }
      } catch (err) {
        capturedCtx.log('error', `pmset displaysleepnow threw: ${String(err)}`);
      }
      return;
    }
    if (action === 'wake-display') {
      if (!capturedCtx) return;
      try {
        const result = await capturedCtx.exec.run('caffeinate', ['-u', '-t', '2']);
        if (result.code !== 0) {
          capturedCtx.log('error', `caffeinate -u -t 2 failed: ${result.stderr}`);
        }
      } catch (err) {
        capturedCtx.log('error', `caffeinate -u -t 2 threw: ${String(err)}`);
      }
      return;
    }
  },
  onEvent() {},
};

export default energySaverPlugin;
