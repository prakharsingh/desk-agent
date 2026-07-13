import type { ReactNode } from 'react';

// Shared label/value list row, matching the mockup's repeated inline row
// markup (Overview's System Status list, Device's Connection list, etc).
// `dot` renders a trailing glowing status indicator (green/gray) the way
// the mockup does for every health-ish row; `last` omits the row separator
// for the final row in a group (the group's own border-radius + overflow
// hidden then gives a clean bottom edge).
export function Row({
  label,
  value,
  action,
  dot,
  last,
}: {
  label: string;
  value?: string;
  action?: ReactNode;
  dot?: string;
  last?: boolean;
}) {
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
      {value && (
        <span
          style={{
            fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
            fontSize: 12,
            color: 'var(--text2)',
            marginRight: dot || action ? 12 : 0,
          }}
        >
          {value}
        </span>
      )}
      {action}
      {dot && <i style={{ width: 8, height: 8, borderRadius: '50%', background: dot, boxShadow: `0 0 7px ${dot}`, display: 'inline-block' }} />}
    </div>
  );
}
