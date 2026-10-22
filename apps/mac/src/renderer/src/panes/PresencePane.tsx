import { useState, type ReactNode } from 'react';
import type { Config } from '@desk-agent/config-schema';
import type { StatusSnapshot } from '@desk-agent/core';
import { Switch } from '../ui/Switch.js';
import { Stepper } from '../ui/Stepper.js';
import { GroupLabel } from '../ui/GroupLabel.js';
import { Group } from '../ui/Group.js';
import { StatusDot } from '../ui/StatusDot.js';
import { fillColor, monoFontFamily, textColor } from '../theme.js';
import { cameraToggleState } from '../presenceToggles.js';

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
        background: active ? 'color-mix(in srgb, var(--green-fill) 14%, transparent)' : 'var(--groupHi)',
        border: active ? '1px solid color-mix(in srgb, var(--green-fill) 40%, transparent)' : '1px solid var(--border)',
      }}
    >
      <StatusDot color={active ? fillColor('green') : 'var(--text3)'} />
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
          color: active ? textColor('green') : 'var(--text2)',
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

function RowText({ label, sub, subIsKey, hint }: { label: string; sub: string; subIsKey?: boolean; hint?: string | null }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 13, color: 'var(--text)' }}>{label}</span>
      {/* Mono only when the sub-label is a raw config key (an ID). */}
      <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: subIsKey ? monoFontFamily : undefined }}>{sub}</span>
      {hint && <span style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic' }}>{hint}</span>}
    </div>
  );
}

export function PresencePane({
  config,
  onChange,
  onSetWakeEnabled,
  snapshot,
  restarting,
}: {
  config: Config;
  onChange: (next: Config) => void;
  onSetWakeEnabled: (enabled: boolean) => void;
  snapshot: StatusSnapshot | null;
  restarting: boolean;
}) {
  const { presence } = config;
  const currentState = snapshot?.presence.state ?? null;
  const camera = cameraToggleState(snapshot);
  const [cameraPending, setCameraPending] = useState(false);

  async function handleCameraChange(enabled: boolean) {
    setCameraPending(true);
    try {
      await window.deskAgent.setCameraEnabled(enabled);
    } finally {
      setCameraPending(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <GroupLabel>State</GroupLabel>
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

      <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <GroupLabel>Camera &amp; detection</GroupLabel>
        <Group>
          <ControlRow>
            <RowText label="Camera presence" sub="On-device MLKit face detection · set on the phone" hint={camera.hint} />
            {/* Phone-owned (persisted on the phone): shows the phone-reported
                snapshot.camera and sends a request back via action.invoke --
                the switch only flips once the phone confirms. */}
            <Switch
              label="Camera presence"
              title={camera.disabled ? camera.hint ?? undefined : undefined}
              checked={camera.checked}
              disabled={camera.disabled || cameraPending}
              onChange={(enabled) => void handleCameraChange(enabled)}
            />
          </ControlRow>
          <ControlRow>
            <RowText label="Gaze keeps display awake" sub="presence.gazeIsKeepAwake" subIsKey />
            <Switch
              label="Gaze keeps display awake"
              checked={presence.gazeIsKeepAwake}
              onChange={(gazeIsKeepAwake) => onChange({ ...config, presence: { ...presence, gazeIsKeepAwake } })}
            />
          </ControlRow>
          <ControlRow last>
            <RowText label="Monitor wake on return" sub="presence.wakeEnabled" subIsKey />
            {/* Applied live by core + synced to the phone; persisted without a core restart. */}
            <Switch label="Monitor wake on return" checked={presence.wakeEnabled} onChange={(wakeEnabled) => onSetWakeEnabled(wakeEnabled)} />
          </ControlRow>
        </Group>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <GroupLabel>Timing</GroupLabel>
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
