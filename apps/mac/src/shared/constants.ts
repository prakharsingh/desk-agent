// Runtime constants shared across the main/renderer process boundary. Pure
// values, no Node built-ins, safe to import from any process (unlike
// types.ts, which is import-type-only -- this file's exports are meant to
// be imported as real values).

// Where main/index.ts positions the native macOS traffic-light buttons
// (titleBarStyle: 'hiddenInset') and how tall a drag-region band the
// renderer's sidebar reserves above its nav so nothing sits underneath them.
// 52pt matches the content pane's header bar (App.tsx) so the sidebar band
// and the content header read as one unified toolbar strip; y:20 vertically
// centres the ~12pt traffic lights in that 52pt band, and x:20 lines them up
// with the nav icons below. Kept in one place so they can't silently drift.
export const TRAFFIC_LIGHT_POSITION = { x: 20, y: 20 };
export const SIDEBAR_HEADER_DRAG_HEIGHT = 52;
export const CONTENT_HEADER_HEIGHT = SIDEBAR_HEADER_DRAG_HEIGHT;

// The native window surface colors per appearance -- what's visible for the
// frames before the renderer's first paint (open) and after its teardown
// (close). Each must equal that theme's --content (theme.ts imports them for
// exactly that), otherwise those frames flash against the UI.
export const WINDOW_BACKGROUND_DARK = '#1c1c1e';
export const WINDOW_BACKGROUND_LIGHT = '#f4f4f6';

// Translucent (NSVisualEffectView 'sidebar' material) sidebar, like Finder /
// System Settings. Vibrancy only shows through where the web contents are
// transparent, so with it on the BrowserWindow background must be fully
// transparent and the renderer leaves the sidebar unpainted (the content
// pane stays opaque var(--content)). Flip to false to fall back to an opaque
// sidebar + an appearance-matched opaque window background if on-hardware
// testing shows any open/close flash.
export const USE_SIDEBAR_VIBRANCY = true;

const TRANSPARENT = '#00000000';

/**
 * The BrowserWindow backgroundColor for the current appearance. Transparent
 * when the vibrant sidebar is on (an opaque color would cover the material);
 * otherwise the appearance's --content color (the no-flash fix).
 */
export function windowBackgroundColor(dark: boolean, vibrancy: boolean = USE_SIDEBAR_VIBRANCY): string {
  if (vibrancy) return TRANSPARENT;
  return dark ? WINDOW_BACKGROUND_DARK : WINDOW_BACKGROUND_LIGHT;
}
