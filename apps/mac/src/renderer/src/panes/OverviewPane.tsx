import { useEffect, useState } from 'react';
import type { StatusSnapshot } from '@desk-agent/core';
import type { BinaryStatus } from '../../../shared/types.js';
import { Row } from '../ui/Row.js';
import { AppIcon } from '../ui/AppIcon.js';
import { StatCard } from '../ui/StatCard.js';
import { GroupLabel } from '../ui/GroupLabel.js';
import { Group } from '../ui/Group.js';
import { StatusDot } from '../ui/StatusDot.js';
import { fillColor, textColor } from '../theme.js';
import { pairedPhoneName, phoneAppLabel } from '../../../shared/phone.js';
import { coreHealthTone, overallHealth, type CoreHealth } from '../../../shared/health.js';

function formatUptime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

export function OverviewPane({
  snapshot,
  snapshotAt,
  health: coreHealth,
}: {
  snapshot: StatusSnapshot | null;
  snapshotAt: number | null;
  health: CoreHealth | 'unknown';
}) {
  const [binaries, setBinaries] = useState<BinaryStatus | null>(null);
  // The core only pushes a fresh snapshot (and its uptimeMs) every 5s, which
  // otherwise makes the Uptime stat visibly jump in 5-second steps instead of
  // ticking every second. `now` re-renders once a second so the displayed
  // value can be extrapolated as snapshot.core.uptimeMs + elapsed-since-snapshotAt.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    void window.deskAgent.getBinaryStatus().then((status) => {
      if (!cancelled) setBinaries(status);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Same rule as the tray's status dot (shared/health.ts), so they never disagree.
  const health = overallHealth(coreHealth, snapshot);
  // 12px SF Pro in the tone's TEXT token (AA-legible in light mode), led by a
  // flat FILL-token dot.
  const healthLine = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: textColor(health.tone) }}>
      <StatusDot color={fillColor(health.tone)} />
      {health.text}
    </span>
  );
  const green = fillColor('green');
  const off = 'var(--text3)';

  // No snapshot (core not running, or not reported in yet): the headline is
  // all there is to show -- e.g. "core crashed" rather than a generic wait.
  if (!snapshot) return <p style={{ margin: 0 }}>{healthLine}</p>;

  const enabledCount = Object.values(snapshot.plugins).filter((p) => p.enabled).length;
  const totalCount = Object.keys(snapshot.plugins).length;
  const presenceIsPresent = snapshot.presence.state === 'present';
  const liveUptimeMs = snapshot.core.uptimeMs + Math.max(0, now - (snapshotAt ?? now));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <div style={{ width: 72, height: 72, flex: '0 0 72px' }}>
          <AppIcon size={72} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.3px' }}>Desk Agent</span>
          <span style={{ fontSize: 13, color: 'var(--text2)' }}>Repurposed Android · docked Mac companion</span>
          {healthLine}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <StatCard label="Enabled plugins" value={`${enabledCount}/${totalCount}`} />
        <StatCard label="WS port" value={String(snapshot.core.wsPort)} />
        <StatCard label="Denials today" value={String(snapshot.denialsToday)} valueColor={snapshot.denialsToday === 0 ? textColor('green') : undefined} />
        <StatCard label="Uptime" value={formatUptime(liveUptimeMs)} />
      </div>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <GroupLabel>System status</GroupLabel>
        <Group>
          {/* Driven by the core process's own health, not hardcoded green. */}
          <Row label="Core agent" value={`uptime ${formatUptime(liveUptimeMs)}`} dot={fillColor(coreHealthTone(coreHealth))} />
          <Row
            label="Paired phone"
            value={pairedPhoneName(snapshot.device)}
            dot={snapshot.device.serial ? green : off}
          />
          <Row
            label="Phone app"
            value={phoneAppLabel(snapshot.clients)}
            dot={snapshot.clients.connected > 0 ? green : off}
          />
          <Row
            label="adb reverse tunnel"
            value={`${snapshot.device.tunnelStatus}${snapshot.device.serial ? ` (${snapshot.device.serial})` : ''}`}
            dot={snapshot.device.tunnelStatus === 'reissued' ? green : snapshot.device.tunnelStatus === 'failed' ? fillColor('red') : off}
          />
          <Row
            label="Presence engine"
            value={snapshot.presence.state}
            dot={presenceIsPresent ? green : off}
          />
          <Row
            label="Automation"
            value={snapshot.automation.enabled ? 'enabled' : 'paused'}
            dot={snapshot.automation.enabled ? green : off}
            last
          />
        </Group>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <GroupLabel>Binaries</GroupLabel>
        <Group>
          <Row
            label="adb"
            value={binaries === null ? '…' : binaries.adb ? 'found' : 'not found'}
            dot={binaries === null ? off : binaries.adb ? green : off}
          />
          <Row
            label="nowplaying-cli"
            value={binaries === null ? '…' : binaries.nowplayingCli ? 'found' : 'not found'}
            dot={binaries === null ? off : binaries.nowplayingCli ? green : off}
            last
          />
        </Group>
      </section>
    </div>
  );
}
