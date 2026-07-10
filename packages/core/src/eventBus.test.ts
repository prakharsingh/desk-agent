import { describe, it, expect, vi } from 'vitest';
import { EventBus } from './index.js';

describe('EventBus', () => {
  it('delivers a valid published event to a matching listener', () => {
    const bus = new EventBus();
    const listener = vi.fn();
    bus.subscribe('person_present', listener);
    const result = bus.publish({ eventName: 'person_present', data: { present: false } });
    expect(result.accepted).toBe(true);
    expect(listener).toHaveBeenCalledWith({ eventName: 'person_present', data: { present: false } });
  });

  it('delivers every accepted event to a "*" listener', () => {
    const bus = new EventBus();
    const listener = vi.fn();
    bus.subscribe('*', listener);
    bus.publish({ eventName: 'anything', data: {} });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('rejects a malformed payload and does not notify listeners', () => {
    const bus = new EventBus();
    const listener = vi.fn();
    bus.subscribe('person_present', listener);
    const result = bus.publish({ eventName: 123, data: {} });
    expect(result.accepted).toBe(false);
    expect(result.error).toEqual(expect.any(String));
    expect(listener).not.toHaveBeenCalled();
  });

  it('unsubscribe stops further delivery', () => {
    const bus = new EventBus();
    const listener = vi.fn();
    const unsubscribe = bus.subscribe('person_present', listener);
    unsubscribe();
    bus.publish({ eventName: 'person_present', data: {} });
    expect(listener).not.toHaveBeenCalled();
  });
});
