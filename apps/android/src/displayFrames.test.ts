import { describe, it, expect } from 'vitest';
import { parseFrame } from '@desk-agent/protocol';
import { buildDisplayStartFrame, buildDisplayStopFrame } from './displayFrames.js';

describe('buildDisplayStartFrame', () => {
  it('builds a display.start frame that passes the protocol validator', () => {
    const frame = buildDisplayStartFrame({ w: 2400, h: 1080, orientation: 'landscape' });
    expect(frame.type).toBe('display.start');
    expect(frame.payload).toEqual({ w: 2400, h: 1080, orientation: 'landscape' });
    expect(parseFrame(frame).ok).toBe(true);
  });

  it('includes dpi when the size carried it, and still validates', () => {
    const frame = buildDisplayStartFrame({ w: 2400, h: 1080, orientation: 'landscape', dpi: 402 });
    expect(frame.payload).toEqual({ w: 2400, h: 1080, orientation: 'landscape', dpi: 402 });
    expect(parseFrame(frame).ok).toBe(true);
  });

  it('omits dpi when absent', () => {
    const frame = buildDisplayStartFrame({ w: 1080, h: 2400, orientation: 'portrait' });
    expect('dpi' in (frame.payload as object)).toBe(false);
  });
});

describe('buildDisplayStopFrame', () => {
  it('builds a display.stop frame with a null session and a reason', () => {
    const frame = buildDisplayStopFrame(null, 'reply-timeout');
    expect(frame.type).toBe('display.stop');
    expect(frame.payload).toEqual({ sessionId: null, reason: 'reply-timeout' });
    expect(parseFrame(frame).ok).toBe(true);
  });

  it('omits reason when not given', () => {
    const frame = buildDisplayStopFrame('s1');
    expect(frame.payload).toEqual({ sessionId: 's1' });
    expect(parseFrame(frame).ok).toBe(true);
  });
});
