import type { ReactNode } from 'react';
import type { Config } from '@desk-agent/config-schema';
import type { StatusSnapshot } from '@desk-agent/core';
import { Switch } from '../ui/Switch.js';
import { Stepper } from '../ui/Stepper.js';
import { GroupLabel } from '../ui/GroupLabel.js';
import { Group } from '../ui/Group.js';
import { accent } from '../theme.js';

const STATES: Array<{ value: 'present' | 'maybe-absent' | 'absent'; label: string }> = [
  { value: 'present', label: 'present' },
  { value: 'maybe-absent', label: 'maybe-absent' },
  { value: 'absent', label: 'absent' },
];

function StatePill({ active, label }: { active: boolean; label: string }) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        padding: '9px 14px',
        borderRadius: 8,
        background: active ? 'rgba(48,209,88,0.14)' : 'var(--groupHi)',
        border: active ? '1px solid rgba(48,209,88,0.4)' : '1px solid var(--border)',
      }}
    >
      <i
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          flex: '0 0 8px',
          background: active ? accent.green : '#6e6e73',
          boxShadow: active ? `0 0 7px ${accent.green}` : 'none',
          display: 'inline-block',
        }}
      />
      {/* Text node stays lowercase (matches snapshot.presence.state verbatim)
          and uses CSS text-transform for the all-caps look, so this doesn't
          add a second `/present|maybe-absent|absent/` text match alongside
          OverviewPane's presence row -- Playwright locators scoped to a
          single pane still see exactly one match each. */}
      <span
        style={{
          fontSize: 12,
          fontWeight: 700,
          textTransform: 'uppercase',
          color: active ? 'var(--text)' : 'var(--text2)',
        }}
      >
        {label}
      </span>
    </div>
  );
}

// Local row wrapper matching the mockup's row markup (label + sub on the
// left, control on the right) -- the shared Row component (ui/Row.tsx) is
// value/dot/action-shaped for read-only status lists, not built for an
// arbitrary trailing control like a Switch, so it doesn't fit here.
function ControlRow({ children, last }: { children: ReactNode; last?: boolean }) {
  return <div style={{ display: 'flex', alignItems: 'center', padding: '13px 16px', borderBottom: last ? 'none' : '0.5px solid var(--sep)' }}>{children}</div>;
}

function RowText({ label, sub }: { label: string; sub: string }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 13, color: 'var(--text)' }}>{label}</span>
      <span style={{ fontSize: 11, color: 'var(--text3)' }}>{sub}</span>
    </div>
  );
}

export function PresencePane({
  config,
  onChange,
  snapshot,
  restarting,
}: {
  config: Config;
  onChange: (next: Config) => void;
  snapshot: StatusSnapshot | null;
  restarting: boolean;
}) {
  const { presence } = config;
  const currentState = snapshot?.presence.state ?? null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 720 }}>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <GroupLabel>STATE</GroupLabel>
        <div style={{ background: 'var(--group)', border: '0.5px solid var(--border)', borderRadius: 10, padding: 18, display: 'flex', alignItems: 'center', gap: 10 }}>
          {STATES.map((s, i) => (
            <span key={s.value} style={{ display: 'contents' }}>
              {i > 0 && <span style={{ color: 'var(--text3)', fontSize: 14 }}>→</span>}
              <StatePill active={currentState === s.value} label={s.label} />
            </span>
          ))}
        </div>
        {!snapshot && <span style={{ fontSize: 11, color: 'var(--text3)', paddingLeft: 2 }}>Waiting for core to report in…</span>}
        {restarting && (
          <span style={{ fontSize: 11, color: 'var(--text3)', paddingLeft: 2 }}>
            Restarting core to apply the setting you changed — these fields have no independent live effect until it's back up.
          </span>
        )}
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <GroupLabel>CAMERA &amp; DETECTION</GroupLabel>
        <Group>
          <ControlRow>
            <RowText label="Camera presence" sub="On-device MLKit face detection" />
            {/* No config field backs camera on/off yet (Config's presence
                shape has no cameraEnabled-equivalent) -- rendered disabled
                rather than wired to fake local state, matching the
                honest-not-fake pattern used elsewhere in this port (e.g.
                SystemStatsConfigSchema/EnergySaverConfigSchema's
                informational-only fields) for demo-only mockup elements
                without real backing state. */}
            <Switch label="" checked={false} disabled onChange={() => {}} />
          </ControlRow>
          <ControlRow>
            <RowText label="Gaze keeps display awake" sub="presence.gazeIsKeepAwake" />
            <Switch
              label=""
              checked={presence.gazeIsKeepAwake}
              onChange={(gazeIsKeepAwake) => onChange({ ...config, presence: { ...presence, gazeIsKeepAwake } })}
            />
          </ControlRow>
          <ControlRow last>
            <RowText label="Monitor wake on return" sub="presence.wakeEnabled" />
            <Switch label="" checked={presence.wakeEnabled} onChange={(wakeEnabled) => onChange({ ...config, presence: { ...presence, wakeEnabled } })} />
          </ControlRow>
        </Group>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <GroupLabel>TIMING</GroupLabel>
        <Group>
          <Stepper
            label="Absence timeout"
            sub="presence.absenceTimeoutMs"
            valueMs={presence.absenceTimeoutMs}
            stepMs={30000}
            minMs={60000}
            onChange={(absenceTimeoutMs) => onChange({ ...config, presence: { ...presence, absenceTimeoutMs } })}
          />
          <Stepper
            label="Boot confirmation timeout"
            sub="presence.bootConfirmationTimeoutMs"
            valueMs={presence.bootConfirmationTimeoutMs}
            stepMs={30000}
            minMs={60000}
            onChange={(bootConfirmationTimeoutMs) => onChange({ ...config, presence: { ...presence, bootConfirmationTimeoutMs } })}
          />
          <Stepper
            label="Presence debounce"
            sub="presenceDebounceMs"
            valueMs={config.presenceDebounceMs}
            stepMs={5000}
            minMs={5000}
            onChange={(presenceDebounceMs) => onChange({ ...config, presenceDebounceMs })}
            last
          />
        </Group>
        <span style={{ fontSize: 11, color: 'var(--text3)', paddingLeft: 2, marginTop: 2, lineHeight: 1.5 }}>
          An unhealthy camera or a dropped link always fails safe to PRESENT — the display never sleeps on a guess.
        </span>
      </section>
    </div>
  );
}
