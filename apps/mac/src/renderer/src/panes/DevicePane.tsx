import { useEffect, useState } from 'react';
import type { StatusSnapshot } from '@desk-agent/core';
import { accent, monoFontFamily } from '../theme.js';
import { Switch } from '../ui/Switch.js';
import { Row } from '../ui/Row.js';
import { GroupLabel } from '../ui/GroupLabel.js';
import { Group } from '../ui/Group.js';

export function DevicePane({ snapshot }: { snapshot: StatusSnapshot | null }) {
  const [reissuing, setReissuing] = useState(false);
  const [launchAtLogin, setLaunchAtLoginState] = useState<boolean | null>(null);
  const [launchAtLoginError, setLaunchAtLoginError] = useState(false);
  const [dockWatchEnabled, setDockWatchEnabledState] = useState<boolean | null>(null);
  const [dockWatchError, setDockWatchError] = useState(false);

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

  const lastHello = snapshot.clients.lastHelloAt ? new Date(snapshot.clients.lastHelloAt).toLocaleTimeString() : 'never';
  const tunnelValue = `${snapshot.device.tunnelStatus}${snapshot.device.lastReissueAt ? ` · ${new Date(snapshot.device.lastReissueAt).toLocaleTimeString()}` : ''}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 720 }}>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <GroupLabel>PAIRED DEVICE</GroupLabel>
        <div style={{ background: 'var(--group)', border: '0.5px solid var(--border)', borderRadius: 10, padding: 16, display: 'flex', alignItems: 'center', gap: 16 }}>
          <div
            style={{
              width: 44,
              height: 66,
              borderRadius: 7,
              border: '1.5px solid var(--fieldBorder)',
              background: 'var(--content)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <i
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: accent.green,
                boxShadow: `0 0 7px ${accent.green}`,
                display: 'inline-block',
              }}
            />
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {/* StatusSnapshot['device'] has no model-name field (see
                TunnelStatusSnapshot) -- unlike the mockup's "Pixel 4a" demo
                text, show a generic label plus the real serial/last-hello
                data instead of inventing a device model. */}
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
              {snapshot.device.serial ? 'Paired device' : 'No device paired'}
            </span>
            <span className="mono" style={{ fontFamily: monoFontFamily, fontSize: 11, color: 'var(--text3)' }}>
              serial {snapshot.device.serial ?? 'none'}
            </span>
            <span className="mono" style={{ fontFamily: monoFontFamily, fontSize: 11, color: 'var(--text3)' }}>
              last hello {lastHello}
            </span>
          </div>
        </div>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <GroupLabel>CONNECTION</GroupLabel>
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
            action={
              <button
                type="button"
                onClick={handleReissue}
                disabled={reissuing}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  font: 'inherit',
                  fontSize: 12,
                  color: reissuing ? 'var(--text3)' : accent.blue,
                  cursor: reissuing ? 'default' : 'pointer',
                }}
              >
                {reissuing ? 'Re-issuing…' : 'Re-issue'}
              </button>
            }
          />
          <Row
            label="Auto re-issue on device attach"
            value="not yet implemented"
            action={
              // Not wired to a real setting yet -- TunnelSupervisor has no
              // config field or IPC action for this (mirrors AutomationPane's
              // "+ Add Rule" honest-non-functional pattern). Disabled so it
              // can't be toggled into a false promise. The "not yet
              // implemented" value makes that explicit instead of silently
              // rendering a switch that looks broken.
              <Switch checked={false} onChange={() => {}} label="" disabled />
            }
          />
          <Row label="Watchdog timeout" value={`${snapshot.core.watchdogTimeoutMs / 1000}s`} last />
        </Group>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <GroupLabel>STARTUP</GroupLabel>
        <Group>
          {launchAtLogin === null ? (
            <div style={{ padding: '13px 16px', borderBottom: '0.5px solid var(--sep)' }}>
              <span style={{ fontSize: 13, color: 'var(--text3)' }}>Loading…</span>
            </div>
          ) : (
            <Row label="Launch Desk Agent at login" action={<Switch checked={launchAtLogin} onChange={handleLaunchAtLoginChange} label="" />} />
          )}
          {dockWatchEnabled === null ? (
            <div style={{ padding: '13px 16px' }}>
              <span style={{ fontSize: 13, color: 'var(--text3)' }}>Loading…</span>
            </div>
          ) : (
            <Row
              label="Launch Desk Agent when phone is docked"
              action={<Switch checked={dockWatchEnabled} onChange={handleDockWatchChange} label="" />}
              last
            />
          )}
        </Group>
        {launchAtLoginError && (
          <p style={{ fontSize: 12, color: accent.red, margin: '4px 0 0' }}>
            macOS didn't apply that change — showing the actual current setting.
          </p>
        )}
        {dockWatchError && (
          <p style={{ fontSize: 12, color: accent.red, margin: '4px 0 0' }}>
            macOS didn't apply that change — showing the actual current setting.
          </p>
        )}
      </section>
    </div>
  );
}
