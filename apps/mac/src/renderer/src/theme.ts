// CSS custom-property tokens ported from the approved "Desk Agent Mac"
// design mockup (docs/ zip export, Desk Agent Mac.dc.html's winStyle()).
// Applied as inline custom properties on the app root so every component
// can reference var(--text) etc, exactly as the mockup's own inline styles
// do -- this keeps the port mechanical rather than reinterpreted.
//
// The appearance follows macOS (prefers-color-scheme), see useSystemDark.ts.
import { WINDOW_BACKGROUND_DARK, WINDOW_BACKGROUND_LIGHT } from '../../shared/constants.js';

export type ThemeVars = Record<string, string>;

export type AccentTone = 'green' | 'blue' | 'amber' | 'red';
export const ACCENT_TONES: readonly AccentTone[] = ['green', 'blue', 'amber', 'red'];

// Status/brand colors split by USE, per appearance. A FILL (dots, switch
// tracks, selected-state backgrounds) only needs to read as a color; TEXT
// must meet WCAG AA (4.5:1) against the surface it sits on -- the bright
// system fills (#34C759 etc) fail that on a light background, so light mode
// uses Apple's darker "accessible" variants for text. Dark mode keeps the
// mockup fills, and the green/amber fills double as text (they pass), but the
// system blue/red only clear 3:1 on --group #2c2c2e, so dark TEXT uses Apple's
// lighter accessible variants (#409CFF / #FF6961) to reach 4.5:1.
export const ACCENT_FILL: Record<'light' | 'dark', Record<AccentTone, string>> = {
  light: { green: '#34C759', blue: '#007AFF', amber: '#FF9500', red: '#FF3B30' },
  dark: { green: '#30D158', blue: '#0A84FF', amber: '#FF9F0A', red: '#FF453A' },
};

export const ACCENT_TEXT: Record<'light' | 'dark', Record<AccentTone, string>> = {
  light: { green: '#1F7A34', blue: '#0066CC', amber: '#C93400', red: '#D70015' },
  dark: { green: '#30D158', blue: '#409CFF', amber: '#FF9F0A', red: '#FF6961' },
};

/** CSS var reference for a tone's TEXT color (labels, values, links). */
export function textColor(tone: AccentTone): string {
  return `var(--${tone}-text)`;
}

/** CSS var reference for a tone's FILL color (status dots, switch tracks). */
export function fillColor(tone: AccentTone): string {
  return `var(--${tone}-fill)`;
}

function accentVars(mode: 'light' | 'dark'): ThemeVars {
  const vars: ThemeVars = {};
  for (const tone of ACCENT_TONES) {
    vars[`--${tone}-fill`] = ACCENT_FILL[mode][tone];
    vars[`--${tone}-text`] = ACCENT_TEXT[mode][tone];
  }
  return vars;
}

export const darkTheme: ThemeVars = {
  '--sidebar': '#242426',
  // Same value as the native BrowserWindow backgroundColor fallback (shared
  // constant), so the two can't drift (a mismatch reintroduces the
  // open/close flash when vibrancy is off).
  '--content': WINDOW_BACKGROUND_DARK,
  '--group': '#2c2c2e',
  '--groupHi': '#333336',
  '--border': 'rgba(255,255,255,0.08)',
  '--sep': 'rgba(255,255,255,0.09)',
  '--text': '#f5f5f7',
  '--text2': '#a1a1a6',
  '--text3': '#98989D',
  '--field': '#1c1c1e',
  '--fieldBorder': 'rgba(255,255,255,0.14)',
  // Sidebar selection: active window = accent; inactive window = neutral.
  '--nav-sel-active': 'rgba(10,132,255,0.85)',
  '--nav-sel-inactive': 'rgba(255,255,255,0.10)',
  // Plugins list selection (a secondary list inside content, so tinted, not solid).
  '--list-sel': 'rgba(10,132,255,0.22)',
  // Push buttons.
  '--btn-bg': 'rgba(255,255,255,0.10)',
  '--btn-border': 'none',
  '--btn-shadow': 'none',
  // Stepper pill.
  '--stepper-bg': 'rgba(255,255,255,0.08)',
  '--stepper-border': 'rgba(255,255,255,0.14)',
  ...accentVars('dark'),
};

export const lightTheme: ThemeVars = {
  '--sidebar': '#e9e9ec',
  '--content': WINDOW_BACKGROUND_LIGHT,
  '--group': '#ffffff',
  '--groupHi': '#f0f0f3',
  '--border': 'rgba(0,0,0,0.09)',
  '--sep': 'rgba(0,0,0,0.08)',
  '--text': '#1d1d1f',
  '--text2': '#6e6e73',
  '--text3': '#6e6e73',
  '--field': '#ffffff',
  '--fieldBorder': 'rgba(0,0,0,0.16)',
  '--nav-sel-active': 'rgba(10,132,255,0.85)',
  '--nav-sel-inactive': 'rgba(0,0,0,0.08)',
  '--list-sel': 'rgba(0,122,255,0.12)',
  '--btn-bg': '#ffffff',
  '--btn-border': '0.5px solid rgba(0,0,0,0.16)',
  '--btn-shadow': '0 0.5px 1px rgba(0,0,0,0.1)',
  '--stepper-bg': '#ffffff',
  '--stepper-border': 'rgba(0,0,0,0.16)',
  ...accentVars('light'),
};

export interface ResolvedTheme {
  vars: ThemeVars;
  colorScheme: 'light' | 'dark';
}

/** Pure: the token set + CSS color-scheme for the current macOS appearance. */
export function resolveTheme(prefersDark: boolean): ResolvedTheme {
  return prefersDark ? { vars: darkTheme, colorScheme: 'dark' } : { vars: lightTheme, colorScheme: 'light' };
}

// Appearance-independent colors that have no light/dark split (log level
// tints on the always-dark log console, automation event badges, brand art).
// Status colors (green/blue/amber/red) must go through textColor()/
// fillColor() instead so they adapt to the appearance.
export const accent = {
  cyan: '#64D2FF',
  brandGreen: '#3f8a56',
};

// The mockup uses IBM Plex Mono loaded from Google Fonts; a packaged,
// sandboxed Electron renderer shouldn't depend on a network font fetch, so
// this substitutes the closest-available system monospace stack instead.
export const monoFontFamily = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
export const sansFontFamily = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif";

// --- WCAG contrast (pure; used by theme.test.ts to pin the token choices) ---

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`relativeLuminance expects #rrggbb, got ${hex}`);
  const n = parseInt(m[1], 16);
  return 0.2126 * channel((n >> 16) & 0xff) + 0.7152 * channel((n >> 8) & 0xff) + 0.0722 * channel(n & 0xff);
}

export function contrastRatio(fg: string, bg: string): number {
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
