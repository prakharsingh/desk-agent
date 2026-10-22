// Flat 8px status dot (no glow -- native macOS status indicators are flat).
// `color` should be a FILL token (fillColor(tone)) or a neutral like var(--text3).
export function StatusDot({ color, size = 8 }: { color: string; size?: number }) {
  return (
    <i
      aria-hidden="true"
      style={{ width: size, height: size, flex: `0 0 ${size}px`, borderRadius: '50%', background: color, display: 'inline-block' }}
    />
  );
}
