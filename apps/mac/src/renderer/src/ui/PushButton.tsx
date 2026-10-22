import type { CSSProperties, ReactNode } from 'react';

// Small macOS-style push button (NSButton "small" bezel): 22pt tall, 6pt
// radius, 12px label in var(--text). Neutral by default; `variant="default"`
// is the blue default-action button -- use it for at most one action per view.
export function PushButton({
  children,
  onClick,
  disabled,
  title,
  variant = 'normal',
  ariaPressed,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  variant?: 'normal' | 'default';
  ariaPressed?: boolean;
}) {
  const isDefault = variant === 'default';
  const style: CSSProperties = {
    height: 22,
    padding: '0 10px',
    borderRadius: 6,
    fontSize: 12,
    fontFamily: 'inherit',
    fontWeight: 400,
    lineHeight: '20px',
    whiteSpace: 'nowrap',
    background: isDefault ? 'var(--blue-fill)' : 'var(--btn-bg)',
    border: isDefault ? '0.5px solid transparent' : 'var(--btn-border)',
    boxShadow: 'var(--btn-shadow)',
    color: isDefault ? '#fff' : 'var(--text)',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.45 : 1,
  };
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} aria-pressed={ariaPressed} style={style}>
      {children}
    </button>
  );
}
