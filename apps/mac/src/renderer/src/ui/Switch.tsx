import type { CSSProperties } from 'react';
import { accent } from '../theme.js';

// Pill-track toggle matching the design mockup's makeSwitch(): a bare
// 38x22 rounded track (green when on, translucent gray when off) with a
// white thumb, no adjacent visible text -- in the mockup and in every pane
// of this port, the switch always sits inside a row that already renders
// its own label text, so a second visible copy of the same label next to
// the switch was a real, visible bug (found by a design-fidelity pass:
// every toggle showed its label twice). `label` is still required and still
// provides the accessible name (via a sr-only span, not `aria-label`, so
// getByLabel/getByRole's accessible-name computation is unaffected) --
// only the VISUAL duplication is removed.
//
// The native <input> stays in the DOM (visually hidden, not display:none)
// purely for accessibility/testing -- getByLabel, keyboard focus, and
// checked state all still work through it -- while the track+thumb are
// drawn as plain sibling elements whose position is computed from the
// `checked` prop directly, so no CSS `:checked`/pseudo-element trickery
// (which would leak globally across every Switch instance) is needed.
const WIDTH = 38;
const HEIGHT = 22;
const THUMB = HEIGHT - 4;

// Visually hidden but still in the accessibility tree (unlike
// display:none/visibility:hidden, which both remove a node's accessible
// name computation) -- the standard "sr-only" clip technique.
const srOnlyStyle: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0,0,0,0)',
  whiteSpace: 'nowrap',
  border: 0,
};

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span style={{ position: 'relative', width: WIDTH, height: HEIGHT, flex: `0 0 ${WIDTH}px` }}>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          style={{ position: 'absolute', inset: 0, margin: 0, opacity: 0, cursor: disabled ? 'default' : 'pointer' }}
        />
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: HEIGHT / 2,
            background: checked ? accent.green : 'rgba(120,120,128,0.32)',
            transition: 'background .18s ease',
            pointerEvents: 'none',
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: 2,
              left: checked ? WIDTH - THUMB - 2 : 2,
              width: THUMB,
              height: THUMB,
              borderRadius: '50%',
              background: '#fff',
              boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
              transition: 'left .18s ease',
            }}
          />
        </span>
      </span>
      {label && <span style={srOnlyStyle}>{label}</span>}
    </label>
  );
}
