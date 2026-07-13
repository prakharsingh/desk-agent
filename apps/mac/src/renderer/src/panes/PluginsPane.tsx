import { useState, type ReactNode } from 'react';
import type { Config } from '@desk-agent/config-schema';
import type { StatusSnapshot } from '@desk-agent/core';
import { Switch } from '../ui/Switch.js';
import { PermChip } from '../ui/PermChip.js';
import { GroupLabel } from '../ui/GroupLabel.js';
import { Group } from '../ui/Group.js';
import { toggleInList } from '../ui/toggleInList.js';
import { monoFontFamily } from '../theme.js';

// The catalog of permission tokens each plugin *could* need is fixed and
// matches packages/core/src/main.ts's resolvePluginRegistry() -- there's no
// need to expose that catalog itself over the ControlChannel. Whether each
// token is actually GRANTED, though, must come from the live
// snapshot.plugins[id].permissions (see PluginsPane below) -- it used to be
// hardcoded here too, which meant this pane's permission chips never
// reflected reality regardless of what the running core actually granted.
const KNOWN_PLUGINS = [
  {
    id: 'system-stats',
    label: 'System Stats',
    description: 'Reads CPU, memory, battery and now-playing from macOS. Publishes the system + now-playing widgets.',
    permissionTokens: ['sys:read-stats', 'sys:control-media', 'sys:control-display'],
  },
  {
    id: 'weather',
    label: 'Weather',
    description: 'Fetches current conditions and a 7-day forecast from Open-Meteo. No API key required.',
    permissionTokens: ['net:api.weather', 'sys:read-stats'],
  },
  {
    id: 'energy-saver',
    label: 'Energy Saver',
    description: 'Sleeps or wakes the docked display in response to presence events, via pmset and caffeinate.',
    permissionTokens: ['sys:control-display', 'sys:read-stats'],
  },
] as const;

// Read-only pill matching the mockup's field style, used for config values
// this app has no IPC path to edit yet (poll intervals, idle action, etc).
function ReadOnlyField({ value }: { value: string }) {
  return (
    <span
      style={{
        fontFamily: monoFontFamily,
        fontSize: 12,
        padding: '5px 12px',
        borderRadius: 7,
        border: '0.5px solid var(--fieldBorder)',
        background: 'var(--field)',
        color: 'var(--text)',
        minWidth: 120,
        textAlign: 'right',
        display: 'inline-block',
      }}
    >
      {value}
    </span>
  );
}

function DetailRow({ label, children, last }: { label: string; children: ReactNode; last?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '13px 16px',
        borderBottom: last ? 'none' : '0.5px solid var(--sep)',
      }}
    >
      <span style={{ fontSize: 13, color: 'var(--text)', flex: 1 }}>{label}</span>
      {children}
    </div>
  );
}

export function PluginsPane({
  config,
  onChange,
  snapshot,
}: {
  config: Config;
  onChange: (next: Config) => void;
  snapshot: StatusSnapshot | null;
}) {
  const [selectedId, setSelectedId] = useState<(typeof KNOWN_PLUGINS)[number]['id']>(KNOWN_PLUGINS[0].id);
  const selected = KNOWN_PLUGINS.find((p) => p.id === selectedId) ?? KNOWN_PLUGINS[0];
  const grantedTokens = new Set(snapshot?.plugins[selected.id]?.permissions ?? []);

  return (
    <div style={{ display: 'flex', gap: 20 }}>
      {/* list */}
      <div style={{ width: 230, flex: '0 0 230px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <GroupLabel>INSTALLED</GroupLabel>
        <Group>
          {KNOWN_PLUGINS.map(({ id, label }, index) => (
            <div
              key={id}
              onClick={() => setSelectedId(id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '12px 14px',
                borderBottom: index === KNOWN_PLUGINS.length - 1 ? 'none' : '0.5px solid var(--sep)',
                cursor: 'pointer',
                background: id === selectedId ? 'var(--groupHi)' : undefined,
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{label}</span>
                <span className="mono" style={{ fontSize: 9, color: 'var(--text3)' }}>
                  {id}
                </span>
              </div>
              <Switch
                label={label}
                checked={config.enabledPlugins.includes(id)}
                onChange={(enabled) => onChange({ ...config, enabledPlugins: toggleInList(config.enabledPlugins, id, enabled) })}
              />
            </div>
          ))}
        </Group>
      </div>

      {/* detail */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 18 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', letterSpacing: -0.2 }}>{selected.label}</span>
            <span style={{ fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.5 }}>{selected.description}</span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
          <GroupLabel>CONFIGURATION</GroupLabel>
          <Group>
            <DetailRow label="Enabled">
              {/* Label is distinct from the list row's Switch (which carries the bare
                  plugin name, e.g. "Energy Saver") so getByLabel(<plugin name>) always
                  resolves uniquely to the list row, even when this plugin is selected
                  and both switches are on screen simultaneously. */}
              <Switch
                label={`${selected.label} enabled`}
                checked={config.enabledPlugins.includes(selected.id)}
                onChange={(enabled) =>
                  onChange({ ...config, enabledPlugins: toggleInList(config.enabledPlugins, selected.id, enabled) })
                }
              />
            </DetailRow>

            {selected.id === 'system-stats' && (
              <>
                <DetailRow label="Poll interval">
                  <ReadOnlyField value={`${config.systemStats.pollIntervalMs / 1000} s`} />
                </DetailRow>
                {/* Not backed by real config or IPC yet -- the mockup's demo state has this
                    permanently on, so we show it checked-but-disabled rather than inventing
                    fake toggle state that would silently do nothing on click. */}
                <DetailRow label="Media transport controls" last>
                  <Switch label="Media transport controls" checked disabled onChange={() => {}} />
                </DetailRow>
              </>
            )}

            {selected.id === 'weather' && (
              <>
                <DetailRow label="Location">
                  <ReadOnlyField value={config.weather.location} />
                </DetailRow>
                <DetailRow label="Poll interval" last>
                  <ReadOnlyField value={`${config.weather.intervalMs / 60000} min`} />
                </DetailRow>
              </>
            )}

            {selected.id === 'energy-saver' && (
              <>
                <DetailRow label="Idle action">
                  <ReadOnlyField value={config.energySaver.idleAction} />
                </DetailRow>
                {/* Not backed by real config or IPC yet -- the mockup's demo state has this
                    permanently on, so we show it checked-but-disabled rather than inventing
                    fake toggle state that would silently do nothing on click. */}
                <DetailRow label="Keep-awake while present" last>
                  <Switch label="Keep-awake while present" checked disabled onChange={() => {}} />
                </DetailRow>
              </>
            )}
          </Group>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <GroupLabel>PERMISSIONS</GroupLabel>
          <div
            style={{
              background: 'var(--group)',
              border: '0.5px solid var(--border)',
              borderRadius: 10,
              padding: 14,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            {selected.permissionTokens.map((token) => (
              <PermChip key={token} token={token} granted={grantedTokens.has(token)} />
            ))}
          </div>
          <span style={{ fontSize: 11, color: 'var(--text3)', paddingLeft: 2, lineHeight: 1.5 }}>
            {snapshot
              ? 'Granted capabilities are enforced per-plugin; anything else is denied and logged.'
              : 'Waiting for the core to report in…'}
          </span>
        </div>
      </div>
    </div>
  );
}
