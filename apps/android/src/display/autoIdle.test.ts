import { describe, it, expect } from 'vitest';
import { shouldAutoIdle, shouldAutoIdleWithConfig } from './autoIdle.js';

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

describe('shouldAutoIdleWithConfig', () => {
  it('is always false when disabled, regardless of elapsed time', () => {
    expect(shouldAutoIdleWithConfig(999_999, { enabled: false, graceMs: 60_000 })).toBe(false);
  });

  it('behaves like shouldAutoIdle when enabled', () => {
    expect(shouldAutoIdleWithConfig(59_999, { enabled: true, graceMs: 60_000 })).toBe(false);
    expect(shouldAutoIdleWithConfig(60_000, { enabled: true, graceMs: 60_000 })).toBe(true);
  });
});
