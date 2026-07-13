import { accent } from '../theme.js';

// Permission-grant chip used in the Plugins pane's detail view, matching
// the mockup's permChip(): a checkmark/green when granted, a hollow circle/
// muted when denied.
export function PermChip({ token, granted }: { token: string; granted: boolean }) {
  return (
    <span
      style={{
        fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
        fontSize: 11,
        padding: '4px 9px',
        borderRadius: 6,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        background: granted ? 'rgba(48,209,88,0.14)' : 'var(--groupHi)',
        border: `0.5px solid ${granted ? 'rgba(48,209,88,0.4)' : 'var(--border)'}`,
        color: granted ? accent.green : 'var(--text3)',
      }}
    >
      <span>{granted ? '✓' : '○'}</span>
      {token}
    </span>
  );
}
