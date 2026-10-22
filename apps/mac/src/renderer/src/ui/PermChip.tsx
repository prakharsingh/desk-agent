import { monoFontFamily, textColor } from '../theme.js';

// Permission-grant chip used in the Plugins pane's detail view, matching
// the mockup's permChip(): a checkmark/green when granted, a hollow circle/
// muted when denied. Green uses the TEXT token (AA-legible in light mode)
// over a tint of the FILL token.
export function PermChip({ token, granted }: { token: string; granted: boolean }) {
  return (
    <span
      style={{
        fontFamily: monoFontFamily,
        fontSize: 11,
        padding: '4px 9px',
        borderRadius: 6,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        background: granted ? 'color-mix(in srgb, var(--green-fill) 14%, transparent)' : 'var(--groupHi)',
        border: `0.5px solid ${granted ? 'color-mix(in srgb, var(--green-fill) 40%, transparent)' : 'var(--border)'}`,
        color: granted ? textColor('green') : 'var(--text3)',
      }}
    >
      <span>{granted ? '✓' : '○'}</span>
      {token}
    </span>
  );
}
