// Overview's 4-up stat grid card, matching the mockup's inline stat-tile
// markup (ENABLED PLUGINS / ACTIVE WIDGETS / WS PORT / DENIALS TODAY).
export function StatCard({ label, value, suffix, valueColor }: { label: string; value: string; suffix?: string; valueColor?: string }) {
  return (
    <div style={{ background: 'var(--group)', border: '0.5px solid var(--border)', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 500 }}>{label.toUpperCase()}</span>
      <span style={{ fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace", fontSize: 24, color: valueColor ?? 'var(--text)' }}>
        {value}
        {suffix && <span style={{ fontSize: 13, color: 'var(--text3)' }}>{suffix}</span>}
      </span>
    </div>
  );
}
