import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launchIsolatedApp } from './helpers.js';

// Proves Phase 2's actual deliverable end-to-end in the packaged build:
// clicking a real toggle in the Plugins pane writes validated config to
// ~/.desk-agent/config.json AND causes the supervised core to restart with
// the new config -- not just that the IPC bridge exists (packaged-smoke.spec
// already covers that).
test('toggling a plugin in the Plugins pane writes config to disk and restarts the core', async () => {
  const isolated = await launchIsolatedApp();
  try {
    const window = await isolated.electronApp.firstWindow();
    window.on('pageerror', (err) => console.log('PAGE ERROR:', err));

    await expect(async () => {
      const health = await window.evaluate(() => (window as any).deskAgent.getCoreHealth());
      expect(health).toBe('running');
    }).toPass({ timeout: 15_000 });

    const configPath = path.join(isolated.homeDir, '.desk-agent', 'config.json');
    const before = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(before.enabledPlugins).toContain('energy-saver');

    await window.getByRole('button', { name: 'Plugins' }).click();
    const energySaverSwitch = window.getByLabel('Energy Saver');
    await expect(energySaverSwitch).toBeChecked();
    await energySaverSwitch.uncheck();

    // The debounced restart fires 800ms after the write; wait past that,
    // then confirm the core actually came back up rather than staying down.
    await expect(async () => {
      const config = await window.evaluate(() => (window as any).deskAgent.getConfig());
      expect(config.enabledPlugins).not.toContain('energy-saver');
    }).toPass({ timeout: 5_000 });

    const after = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(after.enabledPlugins).not.toContain('energy-saver');

    await expect(async () => {
      const health = await window.evaluate(() => (window as any).deskAgent.getCoreHealth());
      expect(health).toBe('running');
    }).toPass({ timeout: 15_000 });
  } finally {
    await isolated.close();
  }
});
