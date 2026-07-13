// The pill-group segmented control used for Light/Dark and the Logs level
// filter, matching the mockup's seg()/segLight/segDark/segLog* styling.
// Real <button> elements (not <span onClick>) so each option is keyboard-
// focusable and screen-reader-navigable, with aria-pressed communicating
// which one is active.
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div role="group" style={{ display: 'flex', alignItems: 'center', gap: 2, padding: 2, background: 'var(--group)', border: '0.5px solid var(--border)', borderRadius: 7 }}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            style={{
              fontSize: 11,
              fontWeight: 500,
              padding: '3px 11px',
              borderRadius: 5,
              border: 'none',
              cursor: 'pointer',
              font: 'inherit',
              background: active ? 'var(--groupHi)' : 'transparent',
              color: active ? 'var(--text)' : 'var(--text2)',
              boxShadow: active ? '0 1px 2px rgba(0,0,0,0.2)' : 'none',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
