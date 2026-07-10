import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Watchdog } from './index.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('Watchdog', () => {
  it('fires onMissed once when no pulse arrives within the timeout', () => {
    const onMissed = vi.fn();
    const watchdog = new Watchdog(5000, onMissed);
    watchdog.start();
    vi.advanceTimersByTime(5000);
    expect(onMissed).toHaveBeenCalledTimes(1);
  });

  it('does not fire onMissed while pulses keep arriving in time', () => {
    const onMissed = vi.fn();
    const watchdog = new Watchdog(5000, onMissed);
    watchdog.start();
    vi.advanceTimersByTime(3000);
    watchdog.pulse();
    vi.advanceTimersByTime(3000);
    watchdog.pulse();
    vi.advanceTimersByTime(3000);
    expect(onMissed).not.toHaveBeenCalled();
  });

  it('does not fire again for the same silence period after already firing once', () => {
    const onMissed = vi.fn();
    const watchdog = new Watchdog(5000, onMissed);
    watchdog.start();
    vi.advanceTimersByTime(5000);
    vi.advanceTimersByTime(5000);
    expect(onMissed).toHaveBeenCalledTimes(1);
  });

  it('stop() cancels future firing', () => {
    const onMissed = vi.fn();
    const watchdog = new Watchdog(5000, onMissed);
    watchdog.start();
    watchdog.stop();
    vi.advanceTimersByTime(5000);
    expect(onMissed).not.toHaveBeenCalled();
  });
});
