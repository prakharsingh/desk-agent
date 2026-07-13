import type { ReactNode, CSSProperties } from 'react';

// Bordered/rounded card shell used by every group in every pane -- was
// independently reimplemented (inline or as a local component) in six
// different pane files before being extracted here. `padded` switches to
// the STATE/paired-device style (internal padding, no row-overflow-hidden)
// used by cards that hold free-form content instead of a list of Rows.
export function Group({ children, padded }: { children: ReactNode; padded?: boolean }) {
  const style: CSSProperties = padded
    ? { background: 'var(--group)', border: '0.5px solid var(--border)', borderRadius: 10, padding: 16 }
    : { background: 'var(--group)', border: '0.5px solid var(--border)', borderRadius: 10, overflow: 'hidden' };
  return <div style={style}>{children}</div>;
}
