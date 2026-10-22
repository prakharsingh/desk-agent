import { useEffect, useState } from 'react';
import type { StatusSnapshot } from '@desk-agent/core';
import { fillColor, monoFontFamily, textColor } from '../theme.js';
import { PushButton } from '../ui/PushButton.js';
import { StatusDot } from '../ui/StatusDot.js';
import { Switch } from '../ui/Switch.js';
import { Row } from '../ui/Row.js';
import { GroupLabel } from '../ui/GroupLabel.js';
import { DeviceGlyph } from '../ui/DeviceGlyph.js';
import { deviceCardTitle } from './deviceCard.js';
import { overallHealth, type CoreHealth } from '../../../shared/health.js';
import { Group } from '../ui/Group.js';

export function DevicePane({ snapshot, health: coreHealth }: { snapshot: StatusSnapshot | null; health: CoreHealth | 'unknown' }) {
  const [reissuing, setReissuing] = useState(false);
  const [launchingApp, setLaunchingApp] = useState(false);
  const [launchAppOnDockPending, setLaunchAppOnDockPending] = useState(false);
  const [launchAtLogin, setLaunchAtLoginState] = useState<boolean | null>(null);
  const [launchAtLoginError, setLaunchAtLoginError] = useState(false);
  const [dockWatchEnabled, setDockWatchEnabledState] = useState<boolean | null>(null);
  const [dockWatchError, setDockWatchError] = useState(false);
  const [screensaverPending, setScreensaverPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.deskAgent.getLaunchAtLogin().then((value) => {
      if (!cancelled) setLaunchAtLoginState(value);
    });
    void window.deskAgent.getDockWatchEnabled().then((value) => {
      if (!cancelled) setDockWatchEnabledState(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!snapshot) return <p>Waiting for the core to report in…</p>;

  async function handleReissue() {
    setReissuing(true);
    try {
      await window.deskAgent.reissueTunnel();
    } finally {
      setReissuing(false);
    }
  }

  async function handleLaunchApp() {
    setLaunchingApp(true);
    try {
      await window.deskAgent.launchApp();
    } finally {
      setLaunchingApp(false);
    }
  }

  // No optimistic local toggle state (unlike launchAtLogin/dockWatch below):
  // this is live core state mirrored straight from the snapshot, same as the
  // automation-engine toggle -- ControlChannel pushes a fresh snapshot right
  // after setLaunchAppOnDock, so `checked` just tracks
  // snapshot.device.launchAppOnDock directly and can't drift.
  async function handleLaunchAppOnDockChange(enabled: boolean) {
    setLaunchAppOnDockPending(true);
    try {
      await window.deskAgent.setLaunchAppOnDock(enabled);
    } finally {
      setLaunchAppOnDockPending(false);
    }
  }

  async function handleLaunchAtLoginChange(enabled: boolean) {
    setLaunchAtLoginState(enabled);
    setLaunchAtLoginError(false);
    try {
      // The IPC call resolves with the ACTUAL resulting OS state (main reads
      // it back after calling setLoginItemSettings, which macOS can silently
      // refuse) -- reconcile to that rather than trusting the optimistic
      // value above, so the switch can never drift from the real OS setting.
      const actual = await window.deskAgent.setLaunchAtLogin(enabled);
      setLaunchAtLoginState(actual);
      if (actual !== enabled) setLaunchAtLoginError(true);
    } catch {
      setLaunchAtLoginError(true);
      // The IPC call itself failed (e.g. main-process error) -- reload the
      // real state rather than leaving the optimistic guess on screen.
      void window.deskAgent.getLaunchAtLogin().then(setLaunchAtLoginState);
    }
  }

  async function handleDockWatchChange(enabled: boolean) {
    setDockWatchEnabledState(enabled);
    setDockWatchError(false);
    try {
      // Same reasoning as handleLaunchAtLoginChange: the IPC call resolves
      // with the ACTUAL resulting state (main re-reads isInstalled() after
      // writing/loading or removing/unloading the LaunchAgent, which
      // launchctl can fail silently) -- reconcile to that, never trust the
      // optimistic value above.
      const actual = await window.deskAgent.setDockWatchEnabled(enabled);
      setDockWatchEnabledState(actual);
      if (actual !== enabled) setDockWatchError(true);
    } catch {
      setDockWatchError(true);
      void window.deskAgent.getDockWatchEnabled().then(setDockWatchEnabledState);
    }
  }

  async function handleScreensaverChange(enabled: boolean, graceMs: number) {
    setScreensaverPending(true);
    try {
      await window.deskAgent.setScreensaverConfig(enabled, graceMs);
    } finally {
      setScreensaverPending(false);
    }
  }

  // Same rule as the tray dot and the Overview headline (core + tunnel + phone app).
  const health = overallHealth(coreHealth, snapshot);
  const lastHello = snapshot.clients.lastHelloAt ? new Date(snapshot.clients.lastHelloAt).toLocaleTimeString() : 'never';
  const tunnelValue = `${snapshot.device.tunnelStatus}${snapshot.device.lastReissueAt ? ` · ${new Date(snapshot.device.lastReissueAt).toLocaleTimeString()}` : ''}`;
  // Both actions run a bare adb command with no device disambiguation when
  // no phone is paired -- adb then falls through to its own default-device
  // selection, which is ambiguous/wrong if another adb device happens to be
  // attached. Disable rather than let that fire silently.
  const noDevicePaired = !snapshot.device.serial;
  // The phone must have an open WebSocket connection to receive a
  // setScreensaverConfig command at all -- distinct from noDevicePaired,
  // which is a USB/adb-attachment signal, not a WS-liveness one.
  const phoneNotConnected = snapshot.clients.connected === 0;
  const launchFailed = snapshot.device.appLaunchStatus === 'failed';
  const noDeviceHint = noDevicePaired ? 'No phone paired over adb' : undefined;
  const phoneHint = phoneNotConnected ? 'Phone app not connected' : undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <GroupLabel>Paired device</GroupLabel>
        <div style={{ background: 'var(--group)', border: '0.5px solid var(--border)', borderRadius: 10, padding: 16, display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* The menu-bar tray glyph (phone + box), with the shared health
              badge at its top-right -- the empty corner above the box. */}
          <div style={{ position: 'relative', width: 56, height: 56, flexShrink: 0 }}>
            <DeviceGlyph size={56} strokeWidth={0.9} color="var(--text)" />
            <span role="img" aria-label={`Status: ${health.text}`} title={health.text} style={{ position: 'absolute', top: 2, right: 2, display: 'flex' }}>
              <StatusDot color={fillColor(health.tone)} />
            </span>
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{deviceCardTitle(snapshot.device)}</span>
            <span className="mono" style={{ fontFamily: monoFontFamily, fontSize: 11, color: 'var(--text3)' }}>
              serial {snapshot.device.serial ?? 'none'}
            </span>
            <span className="mono" style={{ fontFamily: monoFontFamily, fontSize: 11, color: 'var(--text3)' }}>
              last hello {lastHello}
            </span>
          </div>
        </div>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <GroupLabel>Connection</GroupLabel>
        <Group>
          <Row
            label="WebSocket port"
            action={
              <span
                style={{
                  fontFamily: monoFontFamily,
                  fontSize: 12,
                  padding: '5px 12px',
                  borderRadius: 7,
                  border: '0.5px solid var(--fieldBorder)',
                  background: 'var(--field)',
                  color: 'var(--text2)',
                }}
              >
                {snapshot.core.wsPort}
              </span>
            }
          />
          <Row
            label="adb reverse tunnel"
            value={tunnelValue}
            valueColor={snapshot.device.tunnelStatus === 'failed' ? textColor('red') : undefined}
            action={
              <PushButton onClick={handleReissue} disabled={reissuing || noDevicePaired} title={noDeviceHint}>
                {reissuing ? 'Re-issuing…' : 'Re-issue'}
              </PushButton>
            }
          />
          <Row
            label="Launch app on phone"
            value={`${snapshot.device.appLaunchStatus}${snapshot.device.lastAppLaunchAt ? ` · ${new Date(snapshot.device.lastAppLaunchAt).toLocaleTimeString()}` : ''}`}
            // A failed launch must read as failed, not as neutral gray text.
            valueColor={launchFailed ? textColor('red') : undefined}
            dot={launchFailed ? fillColor('red') : undefined}
            action={
              <PushButton onClick={handleLaunchApp} disabled={launchingApp || noDevicePaired} title={noDeviceHint}>
                {launchingApp ? 'Launching…' : 'Launch now'}
              </PushButton>
            }
          />
          <Row label="Watchdog timeout" value={`${snapshot.core.watchdogTimeoutMs / 1000}s`} last />
        </Group>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <GroupLabel>Startup</GroupLabel>
        <Group>
          {launchAtLogin === null ? (
            <div style={{ padding: '13px 16px', borderBottom: '0.5px solid var(--sep)' }}>
              <span style={{ fontSize: 13, color: 'var(--text3)' }}>Loading…</span>
            </div>
          ) : (
            <Row label="Launch Desk Agent at login" action={<Switch checked={launchAtLogin} onChange={handleLaunchAtLoginChange} label="Launch Desk Agent at login" />} />
          )}
          {dockWatchEnabled === null ? (
            <div style={{ padding: '13px 16px', borderBottom: '0.5px solid var(--sep)' }}>
              <span style={{ fontSize: 13, color: 'var(--text3)' }}>Loading…</span>
            </div>
          ) : (
            <Row
              label="Launch Desk Agent when phone is docked"
              action={<Switch checked={dockWatchEnabled} onChange={handleDockWatchChange} label="Launch Desk Agent when phone is docked" />}
            />
          )}
          <Row
            label="Launch app on phone when docked"
            action={
              <Switch
                checked={snapshot.device.launchAppOnDock}
                onChange={handleLaunchAppOnDockChange}
                label="Launch app on phone when docked"
                disabled={launchAppOnDockPending}
              />
            }
            last
          />
        </Group>
        {launchAtLoginError && (
          <p style={{ fontSize: 12, color: textColor('red'), margin: '4px 0 0' }}>
            macOS didn't apply that change — showing the actual current setting.
          </p>
        )}
        {dockWatchError && (
          <p style={{ fontSize: 12, color: textColor('red'), margin: '4px 0 0' }}>
            macOS didn't apply that change — showing the actual current setting.
          </p>
        )}
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <GroupLabel>Phone screensaver</GroupLabel>
        <Group>
          {snapshot.screensaver === null ? (
            <div style={{ padding: '13px 16px' }}>
              <span style={{ fontSize: 13, color: 'var(--text3)' }}>Loading…</span>
            </div>
          ) : (
            <>
              <Row
                label="Enabled"
                action={
                  <Switch
                    checked={snapshot.screensaver.enabled}
                    onChange={(enabled) => handleScreensaverChange(enabled, snapshot.screensaver!.graceMs)}
                    label="Phone screensaver enabled"
                    disabled={screensaverPending || phoneNotConnected}
                    title={phoneHint}
                  />
                }
              />
              <Row
                label="Idle timeout"
                value={`${snapshot.screensaver.graceMs / 60000} min`}
                action={
                  <div role="group" aria-label="Idle timeout" style={{ display: 'flex', gap: 6 }}>
                    {[1, 2, 5, 10, 30].map((min) => {
                      const active = snapshot.screensaver!.graceMs === min * 60000;
                      return (
                        <PushButton
                          key={min}
                          variant={active ? 'default' : 'normal'}
                          ariaPressed={active}
                          onClick={() => handleScreensaverChange(snapshot.screensaver!.enabled, min * 60000)}
                          disabled={screensaverPending || phoneNotConnected}
                          title={phoneHint}
                        >
                          {min}m
                        </PushButton>
                      );
                    })}
                  </div>
                }
                last
              />
            </>
          )}
        </Group>
      </section>
    </div>
  );
}
