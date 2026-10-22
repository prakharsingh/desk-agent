import { test, expect } from '@playwright/test';
import { launchIsolatedApp } from './helpers.js';
import { USE_SIDEBAR_VIBRANCY, windowBackgroundColor } from '../../src/shared/constants.js';

test('packaged app launches, shows the settings window, and boots the supervised core', async () => {
  const isolated = await launchIsolatedApp();
  try {
    const window = await isolated.electronApp.firstWindow();
    window.on('console', (msg) => console.log('PAGE CONSOLE:', msg.type(), msg.text()));
    window.on('pageerror', (err) => console.log('PAGE ERROR:', err));
    await expect(window).toHaveTitle('Desk Agent');

    const pong = await window.evaluate(() => (window as any).deskAgent.ping());
    expect(pong).toBe('pong');

    // The core boots asynchronously (fork + config load + plugin worker
    // spawn); poll rather than assert immediately.
    await expect(async () => {
      const health = await window.evaluate(() => (window as any).deskAgent.getCoreHealth());
      expect(health).toBe('running');
    }).toPass({ timeout: 15_000 });

    await expect(window.getByTestId('core-health')).toHaveText('Core running');
  } finally {
    await isolated.close();
  }
});

test('settings window native background matches the dark theme (no white flash on open/close)', async () => {
  const isolated = await launchIsolatedApp();
  try {
    await isolated.electronApp.firstWindow();
    // The native window surface is what shows for the frames before the
    // renderer's first paint (open) and after its teardown (close). If it's
    // Electron's default white instead of the dark theme's --content, both
    // moments flash white.
    const bg = await isolated.electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getBackgroundColor(),
    );
    // With sidebar vibrancy on the window is intentionally transparent (an
    // opaque fill would cover the material); Electron reports that as
    // '#000000'. With it off it must be the opaque dark theme color. Either
    // way it must never be Electron's default white.
    const expected = USE_SIDEBAR_VIBRANCY ? '#000000' : windowBackgroundColor(true);
    expect(bg.toLowerCase()).toBe(expected);
    expect(bg.toLowerCase()).not.toBe('#ffffff');
  } finally {
    await isolated.close();
  }
});
