import { describe, it, expect } from 'vitest';
import { shouldAutoIdle } from './autoIdle.js';

describe('shouldAutoIdle', () => {
  it('false before the grace window elapses', () => {
    expect(shouldAutoIdle(59_999, 60_000)).toBe(false);
  });
  it('true once the grace window elapses', () => {
    expect(shouldAutoIdle(60_000, 60_000)).toBe(true);
  });
  it('true well past the grace window', () => {
    expect(shouldAutoIdle(120_000, 60_000)).toBe(true);
  });
});
