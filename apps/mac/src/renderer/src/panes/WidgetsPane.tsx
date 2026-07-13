import type { ReactNode } from 'react';
import type { Config } from '@desk-agent/config-schema';
import { WIDGET_IDS } from '@desk-agent/protocol';
import { Switch } from '../ui/Switch.js';
import { Group } from '../ui/Group.js';
import { toggleInList } from '../ui/toggleInList.js';
import { monoFontFamily } from '../theme.js';

const LABELS: Record<(typeof WIDGET_IDS)[number], string> = {
  clock: 'Clock',
  system: 'System',
  weather: 'Weather',
  presence: 'Presence',
  playing: 'Now Playing',
  light: 'Chin Light',
};

const SUBLABELS: Record<(typeof WIDGET_IDS)[number], string> = {
  clock: '24-hour · seconds · uptime',
  system: 'CPU / RAM sparklines · battery',
  weather: 'Units °F · 7-day forecast',
  presence: 'Status badge · sensor readout',
  playing: 'Track · transport controls',
  light: 'Warm/white · brightness · 30 min timeout',
};

const ROADMAP_ITEMS = [
  { label: 'Voice', sublabel: 'Assistant module' },
  { label: 'Steam Deck', sublabel: 'Companion module' },
];

function RoadmapBadge() {
  return (
    <span
      style={{
        fontFamily: monoFontFamily,
        fontSize: 8,
        letterSpacing: 0.5,
        color: 'var(--text3)',
        border: '0.5px solid var(--border)',
        borderRadius: 3,
        padding: '1px 5px',
      }}
    >
      ROADMAP
    </span>
  );
}

function WidgetRow({ label, sub, control, roadmap, last }: { label: string; sub: string; control: ReactNode; roadmap?: boolean; last?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '13px 16px',
        borderBottom: last ? 'none' : '0.5px solid var(--sep)',
        opacity: roadmap ? 0.55 : 1,
      }}
    >
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 13, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
          {label}
          {roadmap && <RoadmapBadge />}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text3)' }}>{sub}</span>
      </div>
      {control}
    </div>
  );
}

export function WidgetsPane({
  config,
  onChange,
  restarting,
}: {
  config: Config;
  onChange: (next: Config) => void;
  restarting: boolean;
}) {
  // One combined list (real widgets + roadmap placeholders) mapped once, so
  // "is this the last row" is a single boundary condition instead of two
  // independently-computed ones that could silently diverge if a third
  // segment were ever added.
  const rows = [
    ...WIDGET_IDS.map((id) => ({
      key: id,
      label: LABELS[id],
      sub: SUBLABELS[id],
      roadmap: false,
      control: (
        <Switch
          label={LABELS[id]}
          checked={config.visibleWidgets.includes(id)}
          onChange={(visible: boolean) => onChange({ ...config, visibleWidgets: toggleInList(config.visibleWidgets, id, visible) })}
        />
      ),
    })),
    ...ROADMAP_ITEMS.map((item) => ({
      key: item.label,
      label: item.label,
      sub: item.sublabel,
      roadmap: true,
      control: (
        <span style={{ color: 'var(--text3)', fontSize: 11 }}>Soon</span>
      ),
    })),
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 720 }}>
      <span style={{ fontSize: 12, color: 'var(--text2)', paddingLeft: 2, lineHeight: 1.5 }}>
        Choose which tiles appear on the docked phone and configure each. Reordering happens on the phone itself.
      </span>
      {restarting && (
        <span style={{ fontSize: 11, color: 'var(--text3)', paddingLeft: 2 }}>
          Restarting core to apply — the phone will pick up the change once it reconnects.
        </span>
      )}
      <div style={{ marginTop: 6 }}>
        <Group>
          {rows.map((row, index) => (
            <WidgetRow key={row.key} label={row.label} sub={row.sub} control={row.control} roadmap={row.roadmap} last={index === rows.length - 1} />
          ))}
        </Group>
      </div>
    </div>
  );
}
