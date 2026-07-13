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

  describe('isEnabled/getRules/setRuleEnabled (Phase 3 state-surface read/toggle API)', () => {
    it('isEnabled reflects setEnabled', () => {
      const engine = new AutomationEngine([sleepRule], { invoke: vi.fn() }, vi.fn());
      expect(engine.isEnabled()).toBe(true);
      engine.setEnabled(false);
      expect(engine.isEnabled()).toBe(false);
    });

    it('getRules maps each rule to a display-only shape without leaking the condition closure, all enabled by default', () => {
      const engine = new AutomationEngine([sleepRule], { invoke: vi.fn() }, vi.fn());
      expect(engine.getRules()).toEqual([
        { id: 'sleep-on-absent', eventName: 'person_present', actionLabel: 'energy-saver · sleep-display', debounceMs: 1000, enabled: true },
      ]);
    });

    it('setRuleEnabled(id, false) is reflected in getRules and suppresses that rule without touching others', () => {
      const otherRule: AutomationRule = { ...sleepRule, id: 'other', eventName: 'other_event' };
      const invoke = vi.fn();
      const engine = new AutomationEngine([sleepRule, otherRule], { invoke }, vi.fn());

      engine.setRuleEnabled('sleep-on-absent', false);
      expect(engine.getRules().find((r) => r.id === 'sleep-on-absent')?.enabled).toBe(false);
      expect(engine.getRules().find((r) => r.id === 'other')?.enabled).toBe(true);

      engine.handleEvent('person_present', { present: false });
      vi.advanceTimersByTime(1000);
      expect(invoke).not.toHaveBeenCalled(); // disabled rule never fires

      engine.handleEvent('other_event', { present: false });
      vi.advanceTimersByTime(1000);
      expect(invoke).toHaveBeenCalledWith('energy-saver', 'sleep-display', undefined); // untouched rule still fires
    });

    it('disabling a rule with an already-armed debounce timer cancels the pending fire', () => {
      const invoke = vi.fn();
      const engine = new AutomationEngine([sleepRule], { invoke }, vi.fn());
      engine.handleEvent('person_present', { present: false });
      engine.setRuleEnabled('sleep-on-absent', false);
      vi.advanceTimersByTime(1000);
      expect(invoke).not.toHaveBeenCalled();
    });

    it('setRuleEnabled(id, true) re-arms a previously disabled rule', () => {
      const invoke = vi.fn();
      const engine = new AutomationEngine([sleepRule], { invoke }, vi.fn());
      engine.setRuleEnabled('sleep-on-absent', false);
      engine.setRuleEnabled('sleep-on-absent', true);
      engine.handleEvent('person_present', { present: false });
      vi.advanceTimersByTime(1000);
      expect(invoke).toHaveBeenCalledWith('energy-saver', 'sleep-display', undefined);
    });
  });
});
