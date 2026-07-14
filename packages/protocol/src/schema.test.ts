import { describe, it, expect } from 'vitest';
import { parseFrame, parseWidget, createFrame, PROTOCOL_VERSION, parseSensorEvent, WIDGET_IDS } from './index.js';
import { parseScreensaverConfig } from './schema.js';

describe('WIDGET_IDS', () => {
  it('is the single source of truth for known widget ids, shared by the Mac config schema and the phone app', () => {
    expect(WIDGET_IDS).toEqual(['clock', 'system', 'weather', 'presence', 'playing', 'light']);
  });
});

describe('parseFrame', () => {
  it('accepts a valid hello frame', () => {
    const raw = { v: 1, type: 'hello', id: 'abc', ts: 123, payload: { clientVersion: '1.0.0' } };
    const result = parseFrame(raw);
    expect(result.ok).toBe(true);
  });

  it('accepts a valid widget.update frame with a widgets array', () => {
    const raw = {
      v: 1,
      type: 'widget.update',
      id: 'abc',
      ts: 123,
      payload: { widgets: [{ widgetId: 'system-stats', widget: { type: 'system-stats', props: { cpu: 12 } } }] },
    };
    expect(parseFrame(raw).ok).toBe(true);
  });

  it('accepts a widget.update frame with an empty widgets array', () => {
    const raw = { v: 1, type: 'widget.update', id: 'abc', ts: 123, payload: { widgets: [] } };
    expect(parseFrame(raw).ok).toBe(true);
  });

  it('accepts a widget.update frame carrying visibleWidgets alongside widgets (the hello-reply snapshot)', () => {
    const raw = { v: 1, type: 'widget.update', id: 'abc', ts: 123, payload: { widgets: [], visibleWidgets: ['clock', 'weather'] } };
    expect(parseFrame(raw).ok).toBe(true);
  });

  it('accepts a widget.update frame with no visibleWidgets (a live single-widget push, not the hello snapshot)', () => {
    const raw = { v: 1, type: 'widget.update', id: 'abc', ts: 123, payload: { widgets: [{ widgetId: 'weather', widget: { type: 'weather', props: {} } }] } };
    expect(parseFrame(raw).ok).toBe(true);
  });

  it('rejects a malformed frame missing required fields', () => {
    const result = parseFrame({ type: 'hello' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual(expect.any(String));
  });

  it('rejects a frame with an unknown type', () => {
    const result = parseFrame({ v: 1, type: 'bogus', id: 'a', ts: 1, payload: {} });
    expect(result.ok).toBe(false);
  });

  it('rejects a version mismatch', () => {
    const result = parseFrame({ v: 2, type: 'heartbeat', id: 'a', ts: 1, payload: {} });
    expect(result.ok).toBe(false);
  });
});

describe('parseWidget', () => {
  it('accepts a valid widget', () => {
    expect(parseWidget({ type: 'weather', props: { tempF: 70 } }).ok).toBe(true);
  });

  it('rejects a widget missing type', () => {
    expect(parseWidget({ props: {} }).ok).toBe(false);
  });
});

describe('createFrame', () => {
  it('stamps the current protocol version and a non-empty id', () => {
    const frame = createFrame('heartbeat', {});
    expect(frame.v).toBe(PROTOCOL_VERSION);
    expect(frame.id.length).toBeGreaterThan(0);
    expect(frame.type).toBe('heartbeat');
  });
});

describe('parseSensorEvent', () => {
  it('accepts a valid sensor.face_visible event', () => {
    expect(parseSensorEvent('sensor.face_visible', { visible: true }).ok).toBe(true);
  });

  it('accepts a valid sensor.gaze_at_screen event', () => {
    expect(parseSensorEvent('sensor.gaze_at_screen', { gazing: false }).ok).toBe(true);
  });

  it('accepts a valid sensor.motion event', () => {
    expect(parseSensorEvent('sensor.motion', { active: true }).ok).toBe(true);
  });

  it('accepts a valid sensor.camera_state event with an optional reason', () => {
    expect(parseSensorEvent('sensor.camera_state', { state: 'error', reason: 'permission-denied' }).ok).toBe(true);
    expect(parseSensorEvent('sensor.camera_state', { state: 'active' }).ok).toBe(true);
  });

  it('rejects an unknown eventName', () => {
    expect(parseSensorEvent('sensor.bogus', {}).ok).toBe(false);
  });

  it('rejects a camera_state with an invalid state enum value', () => {
    expect(parseSensorEvent('sensor.camera_state', { state: 'sleeping' }).ok).toBe(false);
  });

  it('rejects malformed data for a known eventName', () => {
    expect(parseSensorEvent('sensor.motion', { active: 'yes' }).ok).toBe(false);
  });
});

describe('parseFrame with sensor eventNames', () => {
  it('accepts an event.publish frame carrying a sensor eventName (no schema change needed for the envelope)', () => {
    const raw = { v: 1, type: 'event.publish', id: 'a', ts: 1, payload: { eventName: 'sensor.motion', data: { active: true } } };
    expect(parseFrame(raw).ok).toBe(true);
  });
});

describe('parseScreensaverConfig', () => {
  it('accepts a valid config', () => {
    const result = parseScreensaverConfig({ enabled: true, graceMs: 120000 });
    expect(result).toEqual({ ok: true, value: { enabled: true, graceMs: 120000 } });
  });

  it('rejects a missing field', () => {
    const result = parseScreensaverConfig({ enabled: true });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-boolean enabled', () => {
    const result = parseScreensaverConfig({ enabled: 'yes', graceMs: 120000 });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-positive graceMs', () => {
    const result = parseScreensaverConfig({ enabled: true, graceMs: 0 });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-integer graceMs', () => {
    const result = parseScreensaverConfig({ enabled: true, graceMs: 1.5 });
    expect(result.ok).toBe(false);
  });
});
