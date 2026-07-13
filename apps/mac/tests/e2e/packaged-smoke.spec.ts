import { test, expect } from '@playwright/test';
import { launchIsolatedApp } from './helpers.js';

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

    await expect(window.getByTestId('core-health')).toHaveText('Core status: running');
  } finally {
    await isolated.close();
  }
});
