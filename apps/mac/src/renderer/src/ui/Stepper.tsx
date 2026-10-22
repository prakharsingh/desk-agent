import type { CSSProperties } from 'react';
import { monoFontFamily } from '../theme.js';

function formatDuration(ms: number): string {
  return ms >= 60000 ? `${ms / 60000} min` : `${ms / 1000} s`;
}

// Label + a small sub-label (the raw config key, e.g.
// "presence.absenceTimeoutMs") on the left; on the right the value
// (right-aligned, fixed 56px so rows line up) followed by a joined
// macOS-style −|+ stepper pill.
export function Stepper({
  label,
  sub,
  valueMs,
  stepMs,
  minMs = 0,
  onChange,
  last,
}: {
  label: string;
  sub?: string;
  valueMs: number;
  stepMs: number;
  minMs?: number;
  onChange: (next: number) => void;
  last?: boolean;
}) {
  const atMin = valueMs <= minMs;
  const half: CSSProperties = {
    width: 22,
    height: 20,
    border: 'none',
    background: 'transparent',
    color: 'var(--text)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    fontSize: 14,
    lineHeight: 1,
    padding: 0,
    fontFamily: 'inherit',
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '13px 16px', borderBottom: last ? 'none' : '0.5px solid var(--sep)' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 13, color: 'var(--text)' }}>{label}</span>
        {sub && <span style={{ fontFamily: monoFontFamily, fontSize: 11, color: 'var(--text3)' }}>{sub}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          aria-live="polite"
          style={{
            width: 56,
            textAlign: 'right',
            fontFamily: monoFontFamily,
            fontSize: 12,
            color: 'var(--text)',
          }}
        >
          {formatDuration(valueMs)}
        </span>
        <div
          role="group"
          aria-label={label}
          style={{
            display: 'flex',
            alignItems: 'stretch',
            height: 22,
            borderRadius: 6,
            overflow: 'hidden',
            background: 'var(--stepper-bg)',
            border: '0.5px solid var(--stepper-border)',
            boxShadow: 'var(--btn-shadow)',
          }}
        >
          <button
            type="button"
            onClick={() => onChange(Math.max(minMs, valueMs - stepMs))}
            disabled={atMin}
            aria-label={`decrease ${label}`}
            style={{ ...half, opacity: atMin ? 0.35 : 1, cursor: atMin ? 'default' : 'pointer' }}
          >
            −
          </button>
          <span aria-hidden="true" style={{ width: 0.5, background: 'var(--stepper-border)' }} />
          <button type="button" onClick={() => onChange(valueMs + stepMs)} aria-label={`increase ${label}`} style={half}>
            +
          </button>
        </div>
      </div>
    </div>
  );
}
