import type { ReactNode } from 'react';
import { StatusDot } from './StatusDot.js';
import { monoFontFamily } from '../theme.js';

// Shared label/value list row, matching the mockup's repeated inline row
// markup (Overview's System Status list, Device's Connection list, etc).
// `dot` renders a trailing flat status indicator (pass a FILL token, e.g.
// fillColor('green')); `valueColor` overrides the value text color (pass a
// TEXT token, e.g. textColor('red') for a failed state); `last` omits the
// row separator for the final row in a group (the group's own border-radius
// + overflow hidden then gives a clean bottom edge).
export function Row({
  label,
  value,
  valueColor,
  action,
  dot,
  last,
}: {
  label: string;
  value?: string;
  valueColor?: string;
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
        gap: 12,
      }}
    >
      <span style={{ fontSize: 13, color: 'var(--text)', flex: 1 }}>{label}</span>
      {value && (
        <span
          style={{
            fontFamily: monoFontFamily,
            fontSize: 12,
            color: valueColor ?? 'var(--text2)',
          }}
        >
          {value}
        </span>
      )}
      {action}
      {dot && <StatusDot color={dot} />}
    </div>
  );
}
