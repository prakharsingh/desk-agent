// CSS custom-property tokens ported from the approved "Desk Agent Mac"
// design mockup (docs/ zip export, Desk Agent Mac.dc.html's winStyle()).
// Applied as inline custom properties on the app root so every component
// can reference var(--text) etc, exactly as the mockup's own inline styles
// do -- this keeps the port mechanical rather than reinterpreted.
export type ThemeVars = Record<string, string>;

export const darkTheme: ThemeVars = {
  '--sidebar': '#242426',
  '--content': '#1c1c1e',
  '--group': '#2c2c2e',
  '--groupHi': '#333336',
  '--border': 'rgba(255,255,255,0.08)',
  '--sep': 'rgba(255,255,255,0.09)',
  '--text': '#f5f5f7',
  '--text2': '#a1a1a6',
  '--text3': '#6e6e73',
  '--field': '#1c1c1e',
  '--fieldBorder': 'rgba(255,255,255,0.14)',
};

export const lightTheme: ThemeVars = {
  '--sidebar': '#e9e9ec',
  '--content': '#f4f4f6',
  '--group': '#ffffff',
  '--groupHi': '#f0f0f3',
  '--border': 'rgba(0,0,0,0.09)',
  '--sep': 'rgba(0,0,0,0.08)',
  '--text': '#1d1d1f',
  '--text2': '#6e6e73',
  '--text3': '#8e8e93',
  '--field': '#ffffff',
  '--fieldBorder': 'rgba(0,0,0,0.16)',
};

// Brand/status colors used verbatim throughout the mockup -- not theme-
// dependent (same value in light and dark).
export const accent = {
  blue: '#0A84FF',
  green: '#30D158',
  cyan: '#64D2FF',
  amber: '#FF9F0A',
  red: '#FF453A',
  brandGreen: '#3f8a56',
};

// The mockup uses IBM Plex Mono loaded from Google Fonts; a packaged,
// sandboxed Electron renderer shouldn't depend on a network font fetch, so
// this substitutes the closest-available system monospace stack instead.
export const monoFontFamily = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
export const sansFontFamily = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif";
