// Runtime constants shared across the main/renderer process boundary. Pure
// values, no Node built-ins, safe to import from any process (unlike
// types.ts, which is import-type-only -- this file's exports are meant to
// be imported as real values).

// Where main/index.ts positions the native macOS traffic-light buttons
// (titleBarStyle: 'hiddenInset') and how tall a drag-region spacer the
// renderer's sidebar needs to reserve above its content so nothing sits
// underneath them. Kept in one place so the two can't silently drift apart.
export const TRAFFIC_LIGHT_POSITION = { x: 14, y: 18 };
export const SIDEBAR_HEADER_DRAG_HEIGHT = 30;

// The native window surface color -- what's visible for the frames before
// the renderer's first paint (open) and after its teardown (close). Must
// equal the dark theme's --content (theme.ts imports it for exactly that),
// otherwise those frames flash white against the dark UI.
export const WINDOW_BACKGROUND_COLOR = '#1c1c1e';
