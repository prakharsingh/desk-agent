import { useId } from 'react';

// The menu-bar tray glyph (candidate "B_tab" from the tray-outline draw.swift
// script), recreated as SVG so it scales crisply and follows the theme:
// a phone outline with a solid notch tab at the top, and a small box outline
// in front of its bottom-right that occludes the phone behind it.
//
// Geometry is the tray's own 16x16pt canvas (y-down), stroke centres on
// n+0.75 exactly as in the Swift source. The box's occlusion is a mask
// (knock the box footprint out of the phone) rather than a background-colored
// fill, so it works on any surface (card, sidebar, light or dark).
const PHONE = { x: 1.75, y: 1.75, w: 8, h: 12, r: 2.25 };
const TAB = { x: PHONE.x + PHONE.w / 2 - 1.75, y: PHONE.y, w: 3.5, h: 1.75, r: 0.6 };
const BOX = { x: 5.75, y: 9.75, w: 9, h: 4.5, r: 1.5 };

export function DeviceGlyph({
  size = 16,
  strokeWidth = 1.5,
  color = 'currentColor',
}: {
  /** Rendered width/height in px (the glyph is square). */
  size?: number;
  /** Stroke width in the 16-unit glyph space (1.5 = the tray icon's weight). */
  strokeWidth?: number;
  /** Stroke/fill color; defaults to currentColor so it inherits the theme text token. */
  color?: string;
}) {
  // useId output can contain characters (":" / "«") that are awkward inside
  // url(#...) references -- keep only safe ones.
  const maskId = `device-glyph-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const knockout = strokeWidth / 2;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block', color, overflow: 'visible' }}
    >
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="-1" y="-1" width="18" height="18">
          <rect x="-1" y="-1" width="18" height="18" fill="white" />
          <rect
            x={BOX.x - knockout}
            y={BOX.y - knockout}
            width={BOX.w + 2 * knockout}
            height={BOX.h + 2 * knockout}
            rx={BOX.r + knockout}
            fill="black"
          />
        </mask>
      </defs>
      <g mask={`url(#${maskId})`}>
        <rect
          x={PHONE.x}
          y={PHONE.y}
          width={PHONE.w}
          height={PHONE.h}
          rx={PHONE.r}
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
        <rect x={TAB.x} y={TAB.y} width={TAB.w} height={TAB.h} rx={TAB.r} fill="currentColor" />
      </g>
      <rect
        x={BOX.x}
        y={BOX.y}
        width={BOX.w}
        height={BOX.h}
        rx={BOX.r}
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
    </svg>
  );
}
