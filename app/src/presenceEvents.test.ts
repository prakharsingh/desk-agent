import { describe, it, expect } from 'vitest';
import { buildPresenceFrame, buildOverrideFrame } from './presenceEvents.js';

describe('buildPresenceFrame', () => {
  it('builds an event.publish frame for person_present', () => {
    const frame = buildPresenceFrame(false);
    expect(frame.type).toBe('event.publish');
    expect(frame.payload).toEqual({ eventName: 'person_present', data: { present: false } });
  });
});

describe('buildOverrideFrame', () => {
  it('builds an event.publish frame for automation.override', () => {
    const frame = buildOverrideFrame(true);
    expect(frame.type).toBe('event.publish');
    expect(frame.payload).toEqual({ eventName: 'automation.override', data: { enabled: true } });
  });
});
