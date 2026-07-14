import { test, expect } from '@playwright/test';
import { launchIsolatedApp } from './helpers.js';

// Proves Phase 3's actual deliverable end-to-end in the packaged build: the
// core's ControlChannel pushes real StatusSnapshot/LogEntry data over the
// UtilityProcess message channel, through CoreSupervisor and the main
// process's IPC bridge, into the renderer's live Overview/Device/Logs panes
// -- not just that the plumbing compiles.
test('Overview, Device, and Logs panes show live data pushed from the core\'s ControlChannel', async () => {
  const isolated = await launchIsolatedApp();
  try {
    const window = await isolated.electronApp.firstWindow();
    window.on('pageerror', (err) => console.log('PAGE ERROR:', err));

    await expect(async () => {
      const health = await window.evaluate(() => (window as any).deskAgent.getCoreHealth());
      expect(health).toBe('running');
    }).toPass({ timeout: 15_000 });

    // Overview is the default pane -- no nav click needed. Real data from
    // the core's snapshot, not a loading placeholder.
    await expect(async () => {
      const snapshot = await window.evaluate(() => (window as any).deskAgent.getSnapshot());
      expect(snapshot).not.toBeNull();
      expect(snapshot.core.wsPort).toBe(8787);
    }).toPass({ timeout: 10_000 });
    await expect(window.getByText('8787')).toBeVisible();
    await expect(window.getByText(/present|maybe-absent|absent/)).toBeVisible();

    // Logs: the core's own boot-time log lines (e.g. the tunnel supervisor's
    // "re-issued" line, or a plugin init line) actually arrived and render.
    await window.getByRole('button', { name: 'Logs' }).click();
    await expect(async () => {
      const logs = await window.evaluate(() => (window as any).deskAgent.getLogs());
      expect(logs.length).toBeGreaterThan(0);
    }).toPass({ timeout: 10_000 });

    // Device: reflects the core's tunnel state and exposes the live
    // reissueTunnel control action -- but only when a phone is actually
    // docked. DevicePane legitimately disables the button when
    // snapshot.device.serial is null (see its noDevicePaired guard: firing
    // `adb reverse` with no device paired is ambiguous and unsafe), and a
    // disabled <button> never dispatches a click event at all, so this
    // machine -- and every CI runner, which never has adb or a phone --
    // would otherwise hang here forever waiting for a click that can't
    // happen. Assert whichever state is actually true instead of assuming a
    // device is present.
    await window.getByRole('button', { name: 'Device' }).click();
    await expect(window.getByText('8787')).toBeVisible();
    const reissueButton = window.getByRole('button', { name: 'Re-issue' });
    await expect(reissueButton).toBeVisible();
    const deviceSnapshot = await window.evaluate(() => (window as any).deskAgent.getSnapshot());
    if (deviceSnapshot.device.serial) {
      await reissueButton.click();
      // The button round-trips through a real IPC call (status:reissueTunnel);
      // it re-enables once that promise resolves, proving the action reached
      // the core and came back rather than hanging.
      await expect(reissueButton).toBeEnabled({ timeout: 10_000 });
    } else {
      await expect(reissueButton).toBeDisabled();
    }
  } finally {
    await isolated.close();
  }
});
