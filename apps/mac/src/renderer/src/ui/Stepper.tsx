function formatDuration(ms: number): string {
  return ms >= 60000 ? `${ms / 60000} min` : `${ms / 1000} s`;
}

// Matches the mockup's stepper(): label + a small sub-label (the raw config
// key, e.g. "presence.absenceTimeoutMs") on the left, −/value/+ controls
// styled as bordered squares on the right.
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
  const buttonStyle: React.CSSProperties = {
    width: 24,
    height: 24,
    borderRadius: 6,
    border: '0.5px solid var(--fieldBorder)',
    background: 'var(--field)',
    color: 'var(--text)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    fontSize: 15,
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '13px 16px', borderBottom: last ? 'none' : '0.5px solid var(--sep)' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 13, color: 'var(--text)' }}>{label}</span>
        {sub && <span style={{ fontSize: 11, color: 'var(--text3)' }}>{sub}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="button" onClick={() => onChange(Math.max(minMs, valueMs - stepMs))} aria-label={`decrease ${label}`} style={buttonStyle}>
          −
        </button>
        <span
          style={{
            minWidth: 62,
            textAlign: 'center',
            fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
            fontSize: 12,
            color: 'var(--text)',
          }}
        >
          {formatDuration(valueMs)}
        </span>
        <button type="button" onClick={() => onChange(valueMs + stepMs)} aria-label={`increase ${label}`} style={buttonStyle}>
          +
        </button>
      </div>
    </div>
  );
}
