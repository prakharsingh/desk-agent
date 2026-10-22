import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useConfig } from './useConfig.js';
import { useStatus } from './useStatus.js';
import { OverviewPane } from './panes/OverviewPane.js';
import { PresencePane } from './panes/PresencePane.js';
import { PluginsPane } from './panes/PluginsPane.js';
import { WidgetsPane } from './panes/WidgetsPane.js';
import { AutomationPane } from './panes/AutomationPane.js';
import { DevicePane } from './panes/DevicePane.js';
import { LogsPane } from './panes/LogsPane.js';
import { StatusDot } from './ui/StatusDot.js';
import { fillColor, monoFontFamily, resolveTheme, sansFontFamily, textColor } from './theme.js';
import { useSystemDark, useWindowFocused } from './useSystemAppearance.js';
import { CONTENT_HEADER_HEIGHT, SIDEBAR_HEADER_DRAG_HEIGHT, USE_SIDEBAR_VIBRANCY } from '../../shared/constants.js';
import { coreHealthLabel, overallHealth, type CoreHealth } from '../../shared/health.js';

type Pane = 'overview' | 'presence' | 'plugins' | 'widgets' | 'automation' | 'device' | 'logs';

const NAV: Array<{ id: Pane; label: string; icon: string[] }> = [
  { id: 'overview', label: 'Overview', icon: ['M3 10.5 10 4l7 6.5', 'M5 9v7h10V9'] },
  { id: 'plugins', label: 'Plugins', icon: ['M4 4h5v5H4z', 'M11 4h5v5h-5z', 'M4 11h5v5H4z', 'M11 11h5v5h-5z'] },
  { id: 'widgets', label: 'Widgets', icon: ['M3 4h14v12H3z', 'M3 8h14', 'M8 8v8'] },
  { id: 'presence', label: 'Presence', icon: ['M10 4c-4 0-7 6-7 6s3 6 7 6 7-6 7-6-3-6-7-6z', 'M10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'] },
  { id: 'automation', label: 'Automation', icon: ['M11 2 4 11h5l-1 7 7-9h-5z'] },
  { id: 'device', label: 'Device', icon: ['M3 8h8a3 3 0 0 1 0 6H6', 'M8 6 6 8l2 2', 'M17 12h-2'] },
  { id: 'logs', label: 'Logs', icon: ['M4 5h12', 'M4 10h12', 'M4 15h8'] },
];

function NavIcon({ paths }: { paths: string[] }) {
  return (
    <svg width={16} height={16} viewBox="0 0 20 20" fill="none" style={{ flex: '0 0 16px' }}>
      {paths.map((d, i) => (
        <path key={i} d={d} stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  );
}

// Panes laid out in the single left-aligned content column (maxWidth 680).
// Logs (fills the window height) and Plugins (two-column master/detail) opt
// out and use the full content width.
const FULL_WIDTH_PANES: ReadonlySet<Pane> = new Set(['logs', 'plugins']);

export function App() {
  const [health, setHealth] = useState<CoreHealth | 'unknown'>('unknown');
  const [pane, setPane] = useState<Pane>('overview');
  const dark = useSystemDark();
  const windowFocused = useWindowFocused();
  const { config, saving, error, updateConfig, setWakeEnabled } = useConfig();
  const { snapshot, snapshotAt, logs } = useStatus();

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      const h = await window.deskAgent.getCoreHealth();
      if (!cancelled) setHealth(h);
    }
    void poll();
    const timer = setInterval(poll, 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const theme = resolveTheme(dark);
  // Footer mirrors the tray's status item: same label (coreHealthLabel) and
  // same dot rule (overallHealth -- core + phone + tunnel).
  const footerTone = overallHealth(health, snapshot).tone;
  const rootStyle = {
    ...theme.vars,
    colorScheme: theme.colorScheme,
    display: 'flex',
    height: '100%',
    width: '100%',
    // Transparent so the native 'sidebar' vibrancy material shows through the
    // sidebar; the content pane paints its own opaque var(--content).
    background: USE_SIDEBAR_VIBRANCY ? 'transparent' : 'var(--content)',
    color: 'var(--text)',
    fontFamily: sansFontFamily,
  } as CSSProperties;
  const fullWidth = FULL_WIDTH_PANES.has(pane);

  return (
    <div style={rootStyle}>
      {/* SIDEBAR */}
      <nav
        aria-label="Settings sections"
        style={{
          width: 230,
          flex: '0 0 230px',
          background: USE_SIDEBAR_VIBRANCY ? 'transparent' : 'var(--sidebar)',
          borderRight: '0.5px solid var(--sep)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Reserved for the native macOS traffic lights (BrowserWindow uses
            titleBarStyle: 'hiddenInset', positioned by TRAFFIC_LIGHT_POSITION
            to sit centred in this band) -- a plain drag region the same
            height as the content header so the two read as one toolbar.
            No brand row: the Overview hero carries the app identity. */}
        <div style={{ height: SIDEBAR_HEADER_DRAG_HEIGHT, flex: `0 0 ${SIDEBAR_HEADER_DRAG_HEIGHT}px`, WebkitAppRegion: 'drag' } as CSSProperties} />
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {NAV.map(({ id, label, icon }) => {
            const active = pane === id;
            // Native source-list selection: accent while the window is key,
            // neutral gray (with primary text) when it isn't.
            const selBg = windowFocused ? 'var(--nav-sel-active)' : 'var(--nav-sel-inactive)';
            const selFg = windowFocused ? '#fff' : 'var(--text)';
            return (
              <button
                key={id}
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => setPane(id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '6px 9px',
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 500,
                  fontFamily: 'inherit',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  background: active ? selBg : 'transparent',
                  color: active ? selFg : 'var(--text)',
                }}
              >
                <NavIcon paths={icon} />
                {label}
                {id === 'plugins' && config && (
                  <span style={{ marginLeft: 'auto', fontFamily: monoFontFamily, fontSize: 11, opacity: 0.75 }}>{config.enabledPlugins.length}</span>
                )}
              </button>
            );
          })}
        </div>
        <div style={{ padding: '10px 16px', borderTop: '0.5px solid var(--sep)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <StatusDot color={fillColor(footerTone)} />
          <span data-testid="core-health" style={{ fontSize: 11, color: 'var(--text2)' }}>
            {coreHealthLabel(health)}
          </span>
        </div>
      </nav>

      {/* CONTENT */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--content)', minWidth: 0 }}>
        {/* 52pt header bar, same height as the sidebar's traffic-light band;
            draggable like a native toolbar (nothing interactive lives here).
            Appearance follows macOS -- there's no in-app Light/Dark control. */}
        <div
          style={
            {
              height: CONTENT_HEADER_HEIGHT,
              flex: `0 0 ${CONTENT_HEADER_HEIGHT}px`,
              borderBottom: '0.5px solid var(--sep)',
              display: 'flex',
              alignItems: 'center',
              padding: '0 28px',
              WebkitAppRegion: 'drag',
            } as CSSProperties
          }
        >
          <h1 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{paneTitle(pane)}</h1>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            // Every other pane relies on this wrapper's own scroll (block
            // content that can exceed viewport height); Logs manages its own
            // internal scroll region and needs a definite flex height from
            // this wrapper to actually fill 100% of it instead of shrinking
            // to content, so it opts out of the outer scroll instead.
            overflowY: pane === 'logs' ? 'hidden' : 'auto',
            padding: '24px 28px',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              width: '100%',
              maxWidth: fullWidth ? undefined : 680,
              flex: pane === 'logs' ? '1 1 auto' : '0 0 auto',
              minHeight: 0,
            }}
          >
          {error && <p style={{ color: textColor('red'), fontSize: 13 }}>{error}</p>}
          {pane === 'overview' && <OverviewPane snapshot={snapshot} snapshotAt={snapshotAt} health={health} />}
          {pane === 'device' && <DevicePane snapshot={snapshot} health={health} />}
          {pane === 'automation' && <AutomationPane snapshot={snapshot} />}
          {pane === 'logs' && <LogsPane logs={logs} />}
          {pane === 'presence' && (!config ? <Loading /> : <PresencePane config={config} onChange={updateConfig} onSetWakeEnabled={setWakeEnabled} snapshot={snapshot} restarting={health === 'starting'} />)}
          {pane === 'plugins' && (!config ? <Loading /> : <PluginsPane config={config} onChange={updateConfig} snapshot={snapshot} />)}
          {pane === 'widgets' && (!config ? <Loading /> : <WidgetsPane config={config} onChange={updateConfig} restarting={health === 'starting'} />)}
          {saving && <p style={{ fontSize: 12, color: 'var(--text3)' }}>Saving…</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

function paneTitle(pane: Pane): string {
  const titles: Record<Pane, string> = {
    overview: 'Overview',
    plugins: 'Plugins',
    widgets: 'Widgets',
    presence: 'Presence',
    automation: 'Automation',
    device: 'Device',
    logs: 'Logs',
  };
  return titles[pane];
}

function Loading(): ReactNode {
  return <p style={{ color: 'var(--text2)', fontSize: 13 }}>Loading config…</p>;
}
