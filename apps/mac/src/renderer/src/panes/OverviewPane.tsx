import { useEffect, useState } from 'react';
import type { StatusSnapshot } from '@desk-agent/core';
import type { BinaryStatus } from '../../../shared/types.js';
import { Row } from '../ui/Row.js';
import { AppIcon } from '../ui/AppIcon.js';
import { StatCard } from '../ui/StatCard.js';
import { GroupLabel } from '../ui/GroupLabel.js';
import { Group } from '../ui/Group.js';
import { accent } from '../theme.js';

function formatUptime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

export function OverviewPane({ snapshot, snapshotAt }: { snapshot: StatusSnapshot | null; snapshotAt: number | null }) {
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

  if (!snapshot) return <p>Waiting for the core to report in…</p>;

  const enabledCount = Object.values(snapshot.plugins).filter((p) => p.enabled).length;
  const totalCount = Object.keys(snapshot.plugins).length;
  const presenceIsPresent = snapshot.presence.state === 'present';
  const liveUptimeMs = snapshot.core.uptimeMs + Math.max(0, now - (snapshotAt ?? now));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 760 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <div style={{ width: 72, height: 72, flex: '0 0 72px' }}>
          <AppIcon size={72} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.3px' }}>Desk Agent</span>
          <span style={{ fontSize: 13, color: 'var(--text2)' }}>Repurposed Android · docked Mac companion</span>
          <span
            style={{
              fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
              fontSize: 11,
              color: accent.green,
            }}
          >
            ● all systems healthy
          </span>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <StatCard label="Enabled plugins" value={`${enabledCount}/${totalCount}`} />
        <StatCard label="WS port" value={String(snapshot.core.wsPort)} />
        <StatCard label="Denials today" value={String(snapshot.denialsToday)} valueColor={snapshot.denialsToday === 0 ? accent.green : undefined} />
        <StatCard label="Uptime" value={formatUptime(liveUptimeMs)} />
      </div>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <GroupLabel>SYSTEM STATUS</GroupLabel>
        <Group>
          <Row label="Core agent" value={`uptime ${formatUptime(liveUptimeMs)}`} dot={accent.green} />
          <Row
            label="Paired phone"
            value={snapshot.clients.connected > 0 ? `${snapshot.clients.connected} connected` : 'none'}
            dot={snapshot.clients.connected > 0 ? accent.green : 'var(--text3)'}
          />
          <Row
            label="adb reverse tunnel"
            value={`${snapshot.device.tunnelStatus}${snapshot.device.serial ? ` (${snapshot.device.serial})` : ''}`}
            dot={snapshot.device.tunnelStatus === 'reissued' ? accent.green : 'var(--text3)'}
          />
          <Row
            label="Presence engine"
            value={snapshot.presence.state}
            dot={presenceIsPresent ? accent.green : '#6e6e73'}
          />
          <Row
            label="Automation"
            value={snapshot.automation.enabled ? 'enabled' : 'paused'}
            dot={snapshot.automation.enabled ? accent.green : 'var(--text3)'}
            last
          />
        </Group>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <GroupLabel>BINARIES</GroupLabel>
        <Group>
          <Row
            label="adb"
            value={binaries === null ? '…' : binaries.adb ? 'found' : 'not found'}
            dot={binaries === null ? 'var(--text3)' : binaries.adb ? accent.green : 'var(--text3)'}
          />
          <Row
            label="nowplaying-cli"
            value={binaries === null ? '…' : binaries.nowplayingCli ? 'found' : 'not found'}
            dot={binaries === null ? 'var(--text3)' : binaries.nowplayingCli ? accent.green : 'var(--text3)'}
            last
          />
        </Group>
      </section>
    </div>
  );
}
