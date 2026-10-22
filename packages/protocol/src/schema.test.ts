import { describe, it, expect } from 'vitest';
import { parseFrame, parseWidget, createFrame, PROTOCOL_VERSION, parseSensorEvent, WIDGET_IDS } from './index.js';
import { DISPLAY_VIDEO_PORT, DISPLAY_REASONS } from './schema.js';
import { parseScreensaverConfig, parseCameraConfig, parseWakeEnabled, CAMERA_CONFIG_EVENT, WAKE_ENABLED_EVENT, PHONE_DISPLAY_PLUGIN_ID, SET_CAMERA_ENABLED_ACTION, SET_WAKE_ENABLED_ACTION } from './schema.js';

describe('WIDGET_IDS', () => {
  it('is the single source of truth for known widget ids, shared by the Mac config schema and the phone app', () => {
    expect(WIDGET_IDS).toEqual(['clock', 'system', 'weather', 'presence', 'playing', 'light', 'display']);
  });
});

describe('display frames', () => {
  const base = { v: 1, id: 'd1', ts: 1 };
  const start = { w: 2340, h: 1080, orientation: 'landscape' } as const;

  it('exposes the display constants and leaves PROTOCOL_VERSION alone', () => {
    expect(DISPLAY_VIDEO_PORT).toBe(8788);
    expect(PROTOCOL_VERSION).toBe(1);
    expect(DISPLAY_REASONS).toEqual(expect.arrayContaining(['version-mismatch', 'protocol-error', 'capture-unavailable']));
  });

  it('accepts display.start, with or without dpi', () => {
    expect(parseFrame(createFrame('display.start', start)).ok).toBe(true);
    expect(parseFrame(createFrame('display.start', { ...start, dpi: 402 })).ok).toBe(true);
  });

  it('rejects display.start with an undersized dimension, a bad orientation or a non-positive dpi', () => {
    expect(parseFrame({ ...base, type: 'display.start', payload: { ...start, w: 100 } }).ok).toBe(false);
    expect(parseFrame({ ...base, type: 'display.start', payload: { ...start, orientation: 'square' } }).ok).toBe(false);
    expect(parseFrame({ ...base, type: 'display.start', payload: { ...start, dpi: 0 } }).ok).toBe(false);
    expect(parseFrame({ ...base, type: 'display.start', payload: { ...start, h: 9000 } }).ok).toBe(false);
  });

  it('accepts display.session ready and error, and rejects an unknown state', () => {
    expect(parseFrame(createFrame('display.session', { state: 'ready', sessionId: 's1', videoPort: 8788 })).ok).toBe(true);
    expect(parseFrame(createFrame('display.session', { state: 'error', sessionId: null, reason: 'no-device' })).ok).toBe(true);
    expect(parseFrame({ ...base, type: 'display.session', payload: { state: 'bogus', sessionId: null } }).ok).toBe(false);
    expect(parseFrame({ ...base, type: 'display.session', payload: { state: 'ready', sessionId: '' } }).ok).toBe(false);
  });

  it('accepts display.stop with a null sessionId and an optional reason', () => {
    expect(parseFrame(createFrame('display.stop', { sessionId: null })).ok).toBe(true);
    expect(parseFrame(createFrame('display.stop', { sessionId: null, reason: 'reply-timeout' })).ok).toBe(true);
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

describe('parseCameraConfig', () => {
  it('accepts { enabled: boolean }', () => {
    expect(parseCameraConfig({ enabled: true })).toEqual({ ok: true, value: { enabled: true } });
    expect(parseCameraConfig({ enabled: false })).toEqual({ ok: true, value: { enabled: false } });
  });

  it('rejects a missing or non-boolean enabled', () => {
    expect(parseCameraConfig({}).ok).toBe(false);
    expect(parseCameraConfig({ enabled: 'yes' }).ok).toBe(false);
    expect(parseCameraConfig(null).ok).toBe(false);
  });

  it('round-trips through an event.publish frame named CAMERA_CONFIG_EVENT', () => {
    const frame = createFrame('event.publish', { eventName: CAMERA_CONFIG_EVENT, data: { enabled: true } });
    const parsed = parseFrame(JSON.parse(JSON.stringify(frame)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.value.type !== 'event.publish') throw new Error('expected event.publish');
    expect(parsed.value.payload.eventName).toBe('presence.cameraConfig');
    expect(parseCameraConfig(parsed.value.payload.data)).toEqual({ ok: true, value: { enabled: true } });
  });

  it('round-trips through the Mac->phone action.invoke phone-display/setCameraEnabled frame', () => {
    const frame = createFrame('action.invoke', { pluginId: PHONE_DISPLAY_PLUGIN_ID, action: SET_CAMERA_ENABLED_ACTION, args: { enabled: false } });
    const parsed = parseFrame(JSON.parse(JSON.stringify(frame)));
    if (!parsed.ok || parsed.value.type !== 'action.invoke') throw new Error('expected action.invoke');
    expect(parsed.value.payload.pluginId).toBe('phone-display');
    expect(parsed.value.payload.action).toBe('setCameraEnabled');
    expect(parseCameraConfig(parsed.value.payload.args)).toEqual({ ok: true, value: { enabled: false } });
  });
});

describe('parseWakeEnabled', () => {
  it('accepts { enabled: boolean }', () => {
    expect(parseWakeEnabled({ enabled: false })).toEqual({ ok: true, value: { enabled: false } });
  });

  it('rejects a missing or non-boolean enabled', () => {
    expect(parseWakeEnabled({}).ok).toBe(false);
    expect(parseWakeEnabled({ enabled: 1 }).ok).toBe(false);
  });

  it('round-trips through an event.publish frame named WAKE_ENABLED_EVENT', () => {
    const frame = createFrame('event.publish', { eventName: WAKE_ENABLED_EVENT, data: { enabled: false } });
    const parsed = parseFrame(JSON.parse(JSON.stringify(frame)));
    if (!parsed.ok || parsed.value.type !== 'event.publish') throw new Error('expected event.publish');
    expect(parsed.value.payload.eventName).toBe('presence.wakeEnabled');
    expect(parseWakeEnabled(parsed.value.payload.data)).toEqual({ ok: true, value: { enabled: false } });
  });

  it('round-trips through the core->phone action.invoke phone-display/setWakeEnabled frame', () => {
    const frame = createFrame('action.invoke', { pluginId: PHONE_DISPLAY_PLUGIN_ID, action: SET_WAKE_ENABLED_ACTION, args: { enabled: true } });
    const parsed = parseFrame(JSON.parse(JSON.stringify(frame)));
    if (!parsed.ok || parsed.value.type !== 'action.invoke') throw new Error('expected action.invoke');
    expect(parsed.value.payload.action).toBe('setWakeEnabled');
    expect(parseWakeEnabled(parsed.value.payload.args)).toEqual({ ok: true, value: { enabled: true } });
  });
});
