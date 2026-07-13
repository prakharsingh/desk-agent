import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launchIsolatedApp } from './helpers.js';

// Proves Phase 4's actual deliverables end-to-end in the packaged build:
// the Widgets pane's toggle writes visibleWidgets to disk, and the
// Automation pane's engine toggle round-trips through the core's real
// ControlChannel (not the config file -- automation state lives in the
// core, per the Phase 0 contract). Re-issue tunnel + the Plugins round-trip
// are already covered by status-channel.spec.ts / config-roundtrip.spec.ts.
test('Widgets pane toggle writes visibleWidgets to config', async () => {
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
    expect(before.visibleWidgets).toContain('weather');

    await window.getByRole('button', { name: 'Widgets' }).click();
    const weatherSwitch = window.getByLabel('Weather');
    await expect(weatherSwitch).toBeChecked();
    await weatherSwitch.uncheck();

    await expect(async () => {
      const config = await window.evaluate(() => (window as any).deskAgent.getConfig());
      expect(config.visibleWidgets).not.toContain('weather');
    }).toPass({ timeout: 5_000 });

    const after = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(after.visibleWidgets).not.toContain('weather');
  } finally {
    await isolated.close();
  }
});

test('Automation pane engine toggle round-trips through the core and Overview reflects binaries status', async () => {
  const isolated = await launchIsolatedApp();
  try {
    const window = await isolated.electronApp.firstWindow();
    window.on('pageerror', (err) => console.log('PAGE ERROR:', err));

    await expect(async () => {
      const health = await window.evaluate(() => (window as any).deskAgent.getCoreHealth());
      expect(health).toBe('running');
    }).toPass({ timeout: 15_000 });

    // Overview: the binaries status section renders a real found/not-found
    // verdict (not stuck on the loading placeholder), proving binaries.ts's
    // checkBinaries() reached the renderer over the new IPC handler.
    await expect(window.getByText('adb', { exact: true })).toBeVisible();
    await expect(async () => {
      const snapshot = await window.evaluate(() => (window as any).deskAgent.getBinaryStatus());
      expect(snapshot).toHaveProperty('adb');
      expect(snapshot).toHaveProperty('nowplayingCli');
    }).toPass({ timeout: 10_000 });

    await window.getByRole('button', { name: 'Automation' }).click();
    const engineSwitch = window.getByLabel('Automation engine');
    await expect(async () => {
      const snapshot = await window.evaluate(() => (window as any).deskAgent.getSnapshot());
      expect(snapshot.automation.enabled).toBe(true);
    }).toPass({ timeout: 10_000 });
    await expect(engineSwitch).toBeChecked();

    // The switch is a controlled checkbox bound directly to the remote
    // snapshot (no local optimistic state) -- it only reflects "unchecked"
    // once the real core round-trip completes, so `.click()` + poll below,
    // not `.uncheck()`, which asserts the DOM settles unchecked immediately
    // and races that round-trip.
    await engineSwitch.click();

    // This proves the toggle reached the real core (ControlChannel ->
    // AutomationEngine.setEnabled) and the core pushed a fresh snapshot
    // back, not just that the renderer's local state flipped.
    await expect(async () => {
      const snapshot = await window.evaluate(() => (window as any).deskAgent.getSnapshot());
      expect(snapshot.automation.enabled).toBe(false);
    }).toPass({ timeout: 10_000 });
  } finally {
    await isolated.close();
  }
});
