import { monoFontFamily } from '../theme.js';

// Overview's 4-up stat grid card (Enabled plugins / WS port / Denials today /
// Uptime). `valueColor` should be a TEXT token (textColor(tone)).
export function StatCard({ label, value, suffix, valueColor }: { label: string; value: string; suffix?: string; valueColor?: string }) {
  return (
    <div style={{ background: 'var(--group)', border: '0.5px solid var(--border)', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <span style={{ fontSize: 11, color: 'var(--text2)', fontWeight: 500 }}>{label}</span>
      <span style={{ fontFamily: monoFontFamily, fontSize: 24, color: valueColor ?? 'var(--text)' }}>
        {value}
        {suffix && <span style={{ fontSize: 13, color: 'var(--text3)' }}>{suffix}</span>}
      </span>
    </div>
  );
}
