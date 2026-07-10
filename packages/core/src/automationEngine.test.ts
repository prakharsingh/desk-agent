import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AutomationEngine } from './index.js';
import type { AutomationRule } from './index.js';

const sleepRule: AutomationRule = {
  id: 'sleep-on-absent',
  eventName: 'person_present',
  condition: (data) => data.present === false,
  debounceMs: 1000,
  action: { pluginId: 'energy-saver', action: 'sleep-display' },
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('AutomationEngine', () => {
  it('invokes the action after the debounce window when condition holds', () => {
    const invoke = vi.fn();
    const engine = new AutomationEngine([sleepRule], { invoke }, vi.fn());
    engine.handleEvent('person_present', { present: false });
    expect(invoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(invoke).toHaveBeenCalledWith('energy-saver', 'sleep-display', undefined);
  });

  it('cancels the pending action if condition flips back before debounce elapses', () => {
    const invoke = vi.fn();
    const engine = new AutomationEngine([sleepRule], { invoke }, vi.fn());
    engine.handleEvent('person_present', { present: false });
    vi.advanceTimersByTime(500);
    engine.handleEvent('person_present', { present: true });
    vi.advanceTimersByTime(1000);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('manual override disables all rule firing until re-enabled', () => {
    const invoke = vi.fn();
    const engine = new AutomationEngine([sleepRule], { invoke }, vi.fn());
    engine.setEnabled(false);
    engine.handleEvent('person_present', { present: false });
    vi.advanceTimersByTime(1000);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('logs and skips a rule whose condition throws, never crashing', () => {
    const log = vi.fn();
    const badRule: AutomationRule = { ...sleepRule, id: 'bad', condition: () => { throw new Error('boom'); } };
    const engine = new AutomationEngine([badRule], { invoke: vi.fn() }, log);
    expect(() => engine.handleEvent('person_present', { present: false })).not.toThrow();
    expect(log).toHaveBeenCalledWith('error', expect.stringContaining('bad'));
  });

  it('logs and skips when the invoker throws, never crashing', () => {
    const log = vi.fn();
    const invoke = vi.fn(() => { throw new Error('invoke failed'); });
    const engine = new AutomationEngine([sleepRule], { invoke }, log);
    engine.handleEvent('person_present', { present: false });
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
    expect(log).toHaveBeenCalledWith('error', expect.stringContaining('sleep-on-absent'));
  });
});
