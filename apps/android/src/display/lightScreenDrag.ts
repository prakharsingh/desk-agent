// Converts a horizontal drag gesture into a new brightness value, clamped to
// [0, 1]. Guards against a zero (or negative) track width -- which is the
// real state sliderWidthRef briefly holds before the track's first onLayout
// fires -- by leaving brightness unchanged rather than dividing by zero and
// propagating Infinity/NaN into the clamp (Math.min/Math.max both return NaN
// once either operand is NaN, which would render an invalid background color
// and desync the slider fill/knob from the actual brightness).
export function computeDraggedBrightness(dragStartBrightness: number, dx: number, trackWidth: number): number {
  if (trackWidth <= 0) return dragStartBrightness;
  return Math.max(0, Math.min(1, dragStartBrightness + dx / trackWidth));
}
