import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { debounce } from './debounce.js';

describe('debounce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('coalesces rapid successive calls into a single invocation after the window elapses', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 500);

    debounced();
    debounced();
    debounced();
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('uses the arguments from the last call, not the first', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 500);

    debounced('first');
    debounced('second');
    debounced('third');
    vi.advanceTimersByTime(500);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('third');
  });

  it('a call after the window has already elapsed schedules a fresh, independent invocation', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 500);

    debounced('a');
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1);

    debounced('b');
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith('b');
  });
});
