// Grid geometry for the Deck screen. ~128dp per column keeps every button
// comfortably above the 96dp minimum touch target from the design spec
// (claude.ai/design "Desk Agent" -> deck/deck-screen.html) after the 10dp
// gaps; columns clamp to [2, 5] so tiny or huge screens stay usable.
const MIN_COLUMN_DP = 128;

export function computeDeckGrid(
  widthDp: number,
  buttonCount: number,
  configured?: { rows: number; cols: number },
): { rows: number; cols: number } {
  if (configured) return configured;
  const cols = Math.min(5, Math.max(2, Math.floor(widthDp / MIN_COLUMN_DP)));
  return { rows: Math.ceil(buttonCount / cols), cols };
}
