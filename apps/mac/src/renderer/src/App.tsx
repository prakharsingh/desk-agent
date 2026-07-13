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
import { AppIcon } from './ui/AppIcon.js';
import { Segmented } from './ui/Segmented.js';
import { accent, darkTheme, lightTheme, sansFontFamily, monoFontFamily } from './theme.js';
import { SIDEBAR_HEADER_DRAG_HEIGHT } from '../../shared/constants.js';

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

const HEALTH_DOT: Record<string, string> = {
  running: accent.green,
  starting: '#6e6e73',
  stopped: '#6e6e73',
  crashed: accent.red,
};

export function App() {
  const [health, setHealth] = useState<string>('unknown');
  const [pane, setPane] = useState<Pane>('overview');
  const [dark, setDark] = useState(true);
  const { config, saving, error, updateConfig } = useConfig();
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

  const vars = dark ? darkTheme : lightTheme;
  const rootStyle = {
    ...vars,
    display: 'flex',
    height: '100%',
    width: '100%',
    background: 'var(--content)',
    fontFamily: sansFontFamily,
  } as CSSProperties;

  return (
    <div style={rootStyle}>
      {/* SIDEBAR */}
      <div style={{ width: 230, flex: '0 0 230px', background: 'var(--sidebar)', borderRight: '0.5px solid var(--sep)', display: 'flex', flexDirection: 'column' }}>
        {/* Reserved for the native macOS traffic lights (BrowserWindow uses
            titleBarStyle: 'hiddenInset'), left as a plain drag region -- no
            fake traffic-light dots drawn here, unlike the static mockup
            image, since real ones are already provided by the OS. */}
        <div style={{ height: SIDEBAR_HEADER_DRAG_HEIGHT, WebkitAppRegion: 'drag' } as CSSProperties} />
        <div style={{ padding: '2px 14px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 34, height: 34, flex: '0 0 34px' }}>
            <AppIcon size={34} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Desk Agent</span>
            <span style={{ fontFamily: monoFontFamily, fontSize: 9, color: 'var(--text3)' }}>core · macOS</span>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '2px 10px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {NAV.map(({ id, label, icon }) => {
            const active = pane === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setPane(id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '6px 9px',
                  borderRadius: 7,
                  fontSize: 13,
                  fontWeight: 500,
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  background: active ? accent.blue : 'transparent',
                  color: active ? '#fff' : 'var(--text2)',
                }}
              >
                <NavIcon paths={icon} />
                {label}
                {id === 'plugins' && config && (
                  <span style={{ marginLeft: 'auto', fontFamily: monoFontFamily, fontSize: 10, opacity: 0.75 }}>{config.enabledPlugins.length}</span>
                )}
              </button>
            );
          })}
        </div>
        <div style={{ padding: '10px 16px', borderTop: '0.5px solid var(--sep)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <i
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: HEALTH_DOT[health] ?? '#6e6e73',
              boxShadow: `0 0 8px ${HEALTH_DOT[health] ?? '#6e6e73'}`,
              display: 'inline-block',
            }}
          />
          <span data-testid="core-health" style={{ fontFamily: monoFontFamily, fontSize: 10, color: 'var(--text3)' }}>
            Core status: {health}
          </span>
        </div>
      </div>

      {/* CONTENT */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--content)', minWidth: 0 }}>
        <div style={{ height: 52, flex: '0 0 52px', borderBottom: '0.5px solid var(--sep)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 22px' }}>
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{paneTitle(pane)}</span>
          <Segmented
            options={
              [
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ] as const
            }
            value={dark ? 'dark' : 'light'}
            onChange={(v) => setDark(v === 'dark')}
          />
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
            padding: '24px 26px 32px',
          }}
        >
          {error && <p style={{ color: accent.red }}>{error}</p>}
          {pane === 'overview' && <OverviewPane snapshot={snapshot} snapshotAt={snapshotAt} />}
          {pane === 'device' && <DevicePane snapshot={snapshot} />}
          {pane === 'automation' && <AutomationPane snapshot={snapshot} />}
          {pane === 'logs' && <LogsPane logs={logs} />}
          {pane === 'presence' && (!config ? <Loading /> : <PresencePane config={config} onChange={updateConfig} snapshot={snapshot} restarting={health === 'starting'} />)}
          {pane === 'plugins' && (!config ? <Loading /> : <PluginsPane config={config} onChange={updateConfig} snapshot={snapshot} />)}
          {pane === 'widgets' && (!config ? <Loading /> : <WidgetsPane config={config} onChange={updateConfig} restarting={health === 'starting'} />)}
          {saving && <p style={{ fontSize: 12, color: 'var(--text3)' }}>Saving…</p>}
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
