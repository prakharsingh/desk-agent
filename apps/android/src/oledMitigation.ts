export function computePixelShiftOffset(elapsedMs: number, amplitudePx: number, periodMs: number): { x: number; y: number } {
  const normalizedElapsed = elapsedMs % periodMs;
  const angle = (2 * Math.PI * normalizedElapsed) / periodMs;
  return {
    x: Math.round(amplitudePx * Math.sin(angle)),
    y: Math.round(amplitudePx * Math.sin(angle * 0.5)),
  };
}
