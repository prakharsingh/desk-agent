import { createFrame, type Frame } from '@desk-agent/protocol';

export function buildPresenceFrame(present: boolean): Frame {
  return createFrame('event.publish', { eventName: 'person_present', data: { present } });
}

export function buildOverrideFrame(enabled: boolean): Frame {
  return createFrame('event.publish', { eventName: 'automation.override', data: { enabled } });
}
