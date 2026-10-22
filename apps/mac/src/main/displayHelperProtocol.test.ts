import { describe, it, expect } from 'vitest';
import {
  encodeHelperCommand,
  parseHelperEventLine,
  stableDisplaySerial,
  type HelperStartCommand,
} from './displayHelperProtocol.js';

describe('displayHelperProtocol', () => {
  it('stableDisplaySerial is deterministic, unsigned and never 0', () => {
    expect(stableDisplaySerial('a1b2c3')).toBe(stableDisplaySerial('a1b2c3'));
    expect(stableDisplaySerial('x')).toBeGreaterThan(0);
    expect(stableDisplaySerial('')).toBeGreaterThan(0);
    expect(stableDisplaySerial('a1b2c3')).not.toBe(stableDisplaySerial('a1b2c4'));
    const v = stableDisplaySerial('some-long-device-serial-0123456789');
    expect(v).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(v)).toBe(true);
  });

  it('stableDisplaySerial is FNV-1a 32-bit', () => {
    // Published FNV-1a 32 vectors: "" -> 0x811c9dc5, "a" -> 0xe40c292c, "foobar" -> 0xbf9cf968.
    expect(stableDisplaySerial('')).toBe(0x811c9dc5);
    expect(stableDisplaySerial('a')).toBe(0xe40c292c);
    expect(stableDisplaySerial('foobar')).toBe(0xbf9cf968);
  });

  it('maps an unknown ended reason to helper-crashed', () =>
    expect(parseHelperEventLine('{"evt":"ended","reason":"martian"}')).toEqual({ evt: 'ended', reason: 'helper-crashed' }));

  it('maps a reason that is a DisplayReason but not in Contract C to helper-crashed', () =>
    expect(parseHelperEventLine('{"evt":"ended","reason":"user-exit"}')).toEqual({ evt: 'ended', reason: 'helper-crashed' }));

  it('parses every Contract C event with the helper’s exact keys', () => {
    expect(parseHelperEventLine('{"evt":"ready","displayId":7,"port":8788}')).toEqual({ evt: 'ready', displayId: 7, port: 8788 });
    expect(parseHelperEventLine('{"evt":"connected"}')).toEqual({ evt: 'connected' });
    expect(parseHelperEventLine('{"evt":"paused"}')).toEqual({ evt: 'paused' });
    expect(parseHelperEventLine('{"evt":"resumed"}')).toEqual({ evt: 'resumed' });
    const stats = { evt: 'stats', fps: 60, kbps: 8000, unacked: 1, ackP50Ms: 4.5, ackP95Ms: 11, phoneRendered: 300, phoneDropped: 2 };
    expect(parseHelperEventLine(JSON.stringify(stats))).toEqual(stats);
    expect(parseHelperEventLine('{"evt":"log","level":"warn","message":"hi"}')).toEqual({ evt: 'log', level: 'warn', message: 'hi' });
    for (const reason of [
      'stop-requested', 'phone-bye', 'watchdog', 'connect-timeout', 'parent-exit', 'unsupported', 'capture-unavailable',
      'permission-screen-recording', 'capture-failed', 'port-in-use', 'signal', 'protocol-error', 'version-mismatch',
    ]) {
      expect(parseHelperEventLine(JSON.stringify({ evt: 'ended', reason }))).toEqual({ evt: 'ended', reason });
    }
  });

  it('maps an unknown log level to info', () =>
    expect(parseHelperEventLine('{"evt":"log","level":"debug","message":"x"}')).toEqual({ evt: 'log', level: 'info', message: 'x' }));

  it('returns null for malformed, unknown or ill-typed lines', () => {
    expect(parseHelperEventLine('')).toBeNull();
    expect(parseHelperEventLine('not json')).toBeNull();
    expect(parseHelperEventLine('[1]')).toBeNull();
    expect(parseHelperEventLine('{"evt":"nope"}')).toBeNull();
    expect(parseHelperEventLine('{"evt":"ready","displayId":"7","port":8788}')).toBeNull();
    expect(parseHelperEventLine('{"evt":"log","level":"info"}')).toBeNull();
    expect(parseHelperEventLine('{"evt":"stats","fps":1}')).toBeNull();
  });

  it('encodeHelperCommand is JSON + newline', () => {
    expect(encodeHelperCommand({ cmd: 'stop' })).toBe('{"cmd":"stop"}\n');
    const start: HelperStartCommand = {
      cmd: 'start', sessionId: 's', token: 't', port: 8788, surfaceW: 2400, surfaceH: 1080,
      orientation: 'landscape', serialNum: 5, vendorId: 0x3456, productId: 0x4d44,
    };
    const line = encodeHelperCommand(start);
    expect(line.endsWith('\n')).toBe(true);
    expect(JSON.parse(line)).toEqual(start);
  });
});
