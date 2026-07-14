export type LightColorPreset = 'white' | 'sunlight';

const BASE_COLORS: Record<LightColorPreset, { r: number; g: number; b: number }> = {
  white: { r: 0xff, g: 0xff, b: 0xff },
  sunlight: { r: 0xff, g: 0xb3, b: 0x47 },
};

function toHexByte(value: number): string {
  return Math.round(value).toString(16).padStart(2, '0');
}

/**
 * Maps a color preset + brightness (0-1) to a rendered #rrggbb hex color,
 * by scaling each channel toward black. Brightness is clamped to [0,1] so
 * out-of-range input (e.g. from slider rounding) never produces an invalid
 * color.
 */
export function renderedLightColor(preset: LightColorPreset, brightness: number): string {
  const clamped = Math.max(0, Math.min(1, brightness));
  const base = BASE_COLORS[preset];
  const r = toHexByte(base.r * clamped);
  const g = toHexByte(base.g * clamped);
  const b = toHexByte(base.b * clamped);
  return `#${r}${g}${b}`;
}
