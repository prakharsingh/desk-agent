import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ToCore } from '@desk-agent/core';
import { DISPLAY_ERROR_REASONS } from '@desk-agent/core';
import { DISPLAY_VIDEO_PORT, type DisplayReason } from '@desk-agent/protocol';
import { DisplaySessionManager, HELPER_ERROR_REASONS, type DisplaySessionManagerOptions, type HostLike } from './displaySessionManager.js';
import type { HelperEvent, HelperStartCommand } from './displayHelperProtocol.js';

interface FakeHost extends HostLike {
  started: HelperStartCommand[];
  stopCalls: number;
  running: boolean;
  emit(e: HelperEvent): void;
  exit(info: { reason: DisplayReason; error?: string }): void;
  spawned(): void;
}

function setup(overrides: Partial<DisplaySessionManagerOptions> = {}, { autoSpawn = true } = {}) {
  const hosts: FakeHost[] = [];
  const sent: ToCore[] = [];
  const logs: Array<{ level: string; message: string }> = [];
  const onChange = vi.fn();
  let n = 0;
  const createHost: DisplaySessionManagerOptions['createHost'] = (handlers) => {
    const host: FakeHost = {
      started: [],
      stopCalls: 0,
      running: false,
      start(cmd) {
        host.started.push(cmd);
        host.running = true;
        // The real host reports 'spawn' asynchronously; synchronous here keeps most tests linear.
        if (autoSpawn) handlers.onSpawn();
      },
      spawned() {
        handlers.onSpawn();
      },
      stop() {
        host.stopCalls++;
      },
      isRunning() {
        return host.running;
      },
      emit(e) {
        handlers.onEvent(e);
      },
      exit(info) {
        host.running = false;
        handlers.onExit(info);
      },
    };
    hosts.push(host);
    return host;
  };
  const mgr = new DisplaySessionManager({
    createHost,
    sendToCore: (msg) => sent.push(msg),
    getIds: () => ({ vendorId: 0x3456, productId: 0x4d44 }),
    isSupportedMacOS: () => true,
    onChange,
    onLog: (level, message) => logs.push({ level, message }),
    randomToken: () => `tok${++n}`,
    randomSessionId: () => `sess-${n}`,
    ...overrides,
  });
  return { mgr, hosts, sent, logs, onChange };
}

const START = { w: 2340, h: 1080, orientation: 'landscape' as const, deviceSerial: 'abc123' };
const sessionMsgs = (sent: ToCore[]) => sent.filter((m) => m.kind === 'displaySession');

describe('DisplaySessionManager', () => {
  it('spawns the helper and sends the token to core before the session is active', () => {
    const { mgr, hosts, sent } = setup();
    mgr.handleStartRequest({ ...START, dpi: 400 });

    expect(hosts).toHaveLength(1);
    const cmd = hosts[0].started[0];
    expect(cmd).toMatchObject({
      cmd: 'start', sessionId: 'sess-1', token: 'tok1', port: DISPLAY_VIDEO_PORT,
      surfaceW: 2340, surfaceH: 1080, orientation: 'landscape', vendorId: 0x3456, productId: 0x4d44, dpi: 400,
    });
    expect(cmd.serialNum).toBeGreaterThan(0);
    expect(sent).toEqual([{ kind: 'displayToken', sessionId: 'sess-1', token: 'tok1' }]);
    expect(mgr.isActive()).toBe(false);
  });

  it('holds the token until the helper has actually spawned', () => {
    const { mgr, hosts, sent } = setup({}, { autoSpawn: false });
    mgr.handleStartRequest(START);
    expect(hosts[0].started).toHaveLength(1);
    expect(sent).toEqual([]);
    hosts[0].spawned();
    expect(sent).toEqual([{ kind: 'displayToken', sessionId: 'sess-1', token: 'tok1' }]);
  });

  it('never sends a token for a helper that failed to spawn (ENOENT), and ends with the real error logged', () => {
    const { mgr, hosts, sent, logs } = setup({}, { autoSpawn: false });
    mgr.handleStartRequest(START);
    hosts[0].exit({ reason: 'helper-crashed', error: 'spawn /x/desk-agent-display-helper ENOENT' });
    expect(sent.filter((m) => m.kind === 'displayToken')).toEqual([]);
    expect(sessionMsgs(sent)).toEqual([{ kind: 'displaySession', active: false, sessionId: 'sess-1', videoPort: null, reason: 'helper-crashed' }]);
    expect(logs.some((l) => l.level === 'error' && l.message.includes('ENOENT'))).toBe(true);
  });

  it('sends no token for a session main stopped before its helper spawned', () => {
    const { mgr, hosts, sent } = setup({}, { autoSpawn: false });
    mgr.handleStartRequest(START);
    mgr.handleStopRequest({ sessionId: 'sess-1', reason: 'user-exit' });
    hosts[0].spawned();
    expect(sent.filter((m) => m.kind === 'displayToken')).toEqual([]);
  });

  it("prefers the helper's error reason over main's stop reason", () => {
    const { mgr, hosts, sent } = setup();
    mgr.handleStartRequest(START);
    mgr.handleStopRequest({ sessionId: 'sess-1', reason: 'reply-timeout' });
    hosts[0].exit({ reason: 'permission-screen-recording' });
    expect(sessionMsgs(sent).at(-1)).toEqual({
      kind: 'displaySession', active: false, sessionId: 'sess-1', videoPort: null, reason: 'permission-screen-recording',
    });
  });

  it("keeps main's stop reason over a non-error helper reason and over the host's synthesized helper-crashed", () => {
    const a = setup();
    a.mgr.handleStartRequest(START);
    a.mgr.disconnectFromMenu();
    a.hosts[0].exit({ reason: 'helper-crashed' }); // e.g. SIGKILL escalation without an `ended` line
    expect(sessionMsgs(a.sent).at(-1)).toMatchObject({ reason: 'mac-disconnect' });

    const b = setup();
    b.mgr.handleStartRequest(START);
    b.mgr.handleStopRequest({ sessionId: 'sess-1', reason: 'user-exit' });
    b.hosts[0].exit({ reason: 'watchdog' });
    expect(sessionMsgs(b.sent).at(-1)).toMatchObject({ reason: 'user-exit' });
  });

  it("HELPER_ERROR_REASONS is core's DISPLAY_ERROR_REASONS minus the host-synthesized helper-crashed", () => {
    const expected = [...DISPLAY_ERROR_REASONS].filter((r) => r !== 'helper-crashed').sort();
    expect([...HELPER_ERROR_REASONS].sort()).toEqual(expected);
  });

  it('marks the session active only after the helper reports ready', () => {
    const { mgr, hosts, sent, onChange } = setup();
    mgr.handleStartRequest(START);
    hosts[0].emit({ evt: 'connected' });
    expect(sessionMsgs(sent)).toEqual([]);

    hosts[0].emit({ evt: 'ready', displayId: 7, port: DISPLAY_VIDEO_PORT });
    expect(sessionMsgs(sent)).toEqual([{ kind: 'displaySession', active: true, sessionId: 'sess-1', videoPort: DISPLAY_VIDEO_PORT }]);
    expect(mgr.isActive()).toBe(true);
    expect(onChange).toHaveBeenCalled();
  });

  it("reports the helper's end reason to core", () => {
    const { mgr, hosts, sent } = setup();
    mgr.handleStartRequest(START);
    hosts[0].emit({ evt: 'ready', displayId: 7, port: DISPLAY_VIDEO_PORT });
    // `ended` is informational: only onExit ends the session.
    hosts[0].emit({ evt: 'ended', reason: 'watchdog' });
    expect(sessionMsgs(sent)).toHaveLength(1);
    hosts[0].exit({ reason: 'watchdog' });

    expect(sessionMsgs(sent)[1]).toEqual({ kind: 'displaySession', active: false, sessionId: 'sess-1', videoPort: null, reason: 'watchdog' });
    expect(mgr.isActive()).toBe(false);
  });

  it('reports helper-crashed when the helper dies without ended', () => {
    const { mgr, hosts, sent } = setup();
    mgr.handleStartRequest(START);
    hosts[0].exit({ reason: 'helper-crashed' });
    expect(sessionMsgs(sent)).toEqual([{ kind: 'displaySession', active: false, sessionId: 'sess-1', videoPort: null, reason: 'helper-crashed' }]);
  });

  it('surfaces a spawn error in the log and still ends the session with its sessionId', () => {
    const { mgr, hosts, sent, logs } = setup();
    mgr.handleStartRequest(START);
    hosts[0].exit({ reason: 'helper-crashed', error: 'spawn /x/desk-agent-display-helper ENOENT' });
    expect(logs.some((l) => l.level === 'error' && l.message.includes('ENOENT'))).toBe(true);
    expect(sessionMsgs(sent)).toEqual([{ kind: 'displaySession', active: false, sessionId: 'sess-1', videoPort: null, reason: 'helper-crashed' }]);
  });

  it('ends a session exactly once even if the host reports exit twice', () => {
    const { mgr, hosts, sent } = setup();
    mgr.handleStartRequest(START);
    hosts[0].exit({ reason: 'phone-bye' });
    hosts[0].exit({ reason: 'helper-crashed' });
    expect(sessionMsgs(sent)).toHaveLength(1);
  });

  it('queues a start until the previous helper has exited', () => {
    const { mgr, hosts, sent } = setup();
    mgr.handleStartRequest(START);
    hosts[0].emit({ evt: 'ready', displayId: 7, port: DISPLAY_VIDEO_PORT });
    mgr.handleStartRequest({ ...START, w: 1080, h: 2340, orientation: 'portrait' });

    expect(hosts[0].stopCalls).toBe(1);
    expect(hosts).toHaveLength(1); // the second createHost().start is not called before the first onExit
    // the old helper reports its generic stop-requested; main's 'superseded' wins
    hosts[0].exit({ reason: 'stop-requested' });

    expect(hosts).toHaveLength(2);
    expect(hosts[1].started[0]).toMatchObject({ sessionId: 'sess-2', surfaceW: 1080, orientation: 'portrait' });
    const kinds = sent.map((m) =>
      m.kind === 'displaySession' ? `${m.kind}:${m.active}:${m.sessionId}:${m.reason ?? ''}`
        : m.kind === 'displayToken' ? `${m.kind}:${m.sessionId}` : m.kind);
    expect(kinds).toEqual([
      'displayToken:sess-1',
      'displaySession:true:sess-1:',
      'displaySession:false:sess-1:superseded',
      'displayToken:sess-2',
    ]);
  });

  it('a session main already stopped (token-timeout) reports superseded when a queued start follows, then the next starts', () => {
    const { mgr, hosts, sent, logs } = setup();
    mgr.handleStartRequest(START);
    hosts[0].emit({ evt: 'ready', displayId: 7, port: DISPLAY_VIDEO_PORT });
    mgr.handleStopRequest({ sessionId: 'sess-1', reason: 'token-timeout' });
    // the retry's start lands while A is still stopping (stopCurrent is a no-op now)
    mgr.handleStartRequest({ ...START, w: 1000 });
    expect(hosts).toHaveLength(1);
    hosts[0].exit({ reason: 'stop-requested' });
    expect(sessionMsgs(sent).at(-1)).toEqual({ kind: 'displaySession', active: false, sessionId: 'sess-1', videoPort: null, reason: 'superseded' });
    expect(hosts).toHaveLength(2);
    expect(hosts[1].started[0]).toMatchObject({ sessionId: 'sess-2', surfaceW: 1000 });
    expect(sent.at(-1)).toEqual({ kind: 'displayToken', sessionId: 'sess-2', token: 'tok2' });
    // the real reason is still logged
    expect(logs.some((l) => l.message.includes('sess-1 ended: token-timeout'))).toBe(true);
  });

  it('a helper error is reported as superseded too when a queued start follows (stale for the waiting phone), and logged', () => {
    const { mgr, hosts, sent, logs } = setup();
    mgr.handleStartRequest(START);
    mgr.handleStartRequest({ ...START, w: 1000 });
    hosts[0].exit({ reason: 'permission-screen-recording' });
    expect(sessionMsgs(sent).at(-1)).toMatchObject({ sessionId: 'sess-1', reason: 'superseded' });
    expect(hosts).toHaveLength(2);
    expect(logs.some((l) => l.message.includes('sess-1 ended: permission-screen-recording'))).toBe(true);
    expect(logs.some((l) => l.message.includes('reporting permission-screen-recording to core as superseded'))).toBe(true);
  });

  it('without a queued start the original reason is reported unchanged', () => {
    const { mgr, hosts, sent } = setup();
    mgr.handleStartRequest(START);
    mgr.handleStopRequest({ sessionId: 'sess-1', reason: 'token-timeout' });
    hosts[0].exit({ reason: 'stop-requested' });
    expect(sessionMsgs(sent).at(-1)).toMatchObject({ sessionId: 'sess-1', reason: 'token-timeout' });
    expect(hosts).toHaveLength(1);
  });

  it('a queued start dropped by shutdown does not turn the end into superseded', () => {
    const { mgr, hosts, sent } = setup();
    mgr.handleStartRequest(START);
    mgr.handleStopRequest({ sessionId: 'sess-1', reason: 'token-timeout' });
    mgr.handleStartRequest({ ...START, w: 1000 });
    mgr.shutdown();
    hosts[0].exit({ reason: 'stop-requested' });
    expect(sessionMsgs(sent).at(-1)).toMatchObject({ sessionId: 'sess-1', reason: 'token-timeout' });
    expect(hosts).toHaveLength(1);
  });

  it('a third start while one is queued replaces the queued one', () => {
    const { mgr, hosts } = setup();
    mgr.handleStartRequest(START);
    mgr.handleStartRequest({ ...START, w: 1000 });
    mgr.handleStartRequest({ ...START, w: 1200 });
    expect(hosts[0].stopCalls).toBe(1);
    hosts[0].exit({ reason: 'stop-requested' });
    expect(hosts).toHaveLength(2);
    expect(hosts[1].started[0].surfaceW).toBe(1200);
  });

  it('ignores a stop for a stale sessionId', () => {
    const { mgr, hosts } = setup();
    mgr.handleStartRequest(START);
    mgr.handleStopRequest({ sessionId: 'old-session', reason: 'user-exit' });
    expect(hosts[0].stopCalls).toBe(0);
  });

  it('a stop for the current session ends it with the requested reason', () => {
    const { mgr, hosts, sent } = setup();
    mgr.handleStartRequest(START);
    hosts[0].emit({ evt: 'ready', displayId: 7, port: DISPLAY_VIDEO_PORT });
    mgr.handleStopRequest({ sessionId: 'sess-1', reason: 'reply-timeout' });
    expect(hosts[0].stopCalls).toBe(1);
    hosts[0].exit({ reason: 'stop-requested' });
    expect(sessionMsgs(sent).at(-1)).toEqual({ kind: 'displaySession', active: false, sessionId: 'sess-1', videoPort: null, reason: 'reply-timeout' });
  });

  it('a null-sessionId stop stops the current session and drops a queued start', () => {
    const { mgr, hosts, sent } = setup();
    mgr.handleStartRequest(START);
    mgr.handleStartRequest({ ...START, w: 1000 });
    mgr.handleStopRequest({ sessionId: null, reason: 'user-exit' });
    hosts[0].exit({ reason: 'stop-requested' });
    expect(hosts).toHaveLength(1);
    // never sessionId null for a started session
    expect(sessionMsgs(sent).every((m) => m.kind === 'displaySession' && m.sessionId === 'sess-1')).toBe(true);
  });

  it('resyncs an active session on the first snapshot after a core restart, once', () => {
    const { mgr, hosts, sent } = setup();
    mgr.handleStartRequest(START);
    hosts[0].emit({ evt: 'ready', displayId: 7, port: DISPLAY_VIDEO_PORT });
    sent.length = 0;

    mgr.onCoreSnapshot(); // not armed: nothing
    expect(sent).toEqual([]);
    mgr.onCoreRunning();
    mgr.onCoreSnapshot();
    mgr.onCoreSnapshot();
    expect(sent).toEqual([{ kind: 'displaySession', active: true, sessionId: 'sess-1', videoPort: DISPLAY_VIDEO_PORT }]);
  });

  it('re-sends the token of a pending session (token sent, not ready) to a restarted core, once', () => {
    const { mgr, sent } = setup();
    mgr.handleStartRequest(START);
    sent.length = 0;
    mgr.onCoreRunning();
    mgr.onCoreSnapshot();
    mgr.onCoreSnapshot();
    expect(sent).toEqual([{ kind: 'displayToken', sessionId: 'sess-1', token: 'tok1' }]);
  });

  it('resends nothing for a pending session that has not spawned yet or that main is stopping', () => {
    const notSpawned = setup({}, { autoSpawn: false });
    notSpawned.mgr.handleStartRequest(START);
    notSpawned.mgr.onCoreRunning();
    notSpawned.mgr.onCoreSnapshot();
    expect(notSpawned.sent).toEqual([]);

    const stopping = setup();
    stopping.mgr.handleStartRequest(START);
    stopping.mgr.handleStopRequest({ sessionId: 'sess-1', reason: 'user-exit' });
    stopping.sent.length = 0;
    stopping.mgr.onCoreRunning();
    stopping.mgr.onCoreSnapshot();
    expect(stopping.sent).toEqual([]);
  });

  it('sends nothing on resync when no session is active', () => {
    const { mgr, sent } = setup();
    mgr.onCoreRunning();
    mgr.onCoreSnapshot();
    expect(sent).toEqual([]);
  });

  it('refuses with unsupported on macOS older than 14 without spawning', () => {
    const { mgr, hosts, sent } = setup({ isSupportedMacOS: () => false });
    mgr.handleStartRequest(START);
    expect(hosts).toHaveLength(0);
    expect(sent).toEqual([{ kind: 'displaySession', active: false, sessionId: null, videoPort: null, reason: 'unsupported' }]);
  });

  it('stops with mac-disconnect from the menu', () => {
    const { mgr, hosts, sent } = setup();
    mgr.handleStartRequest(START);
    hosts[0].emit({ evt: 'ready', displayId: 7, port: DISPLAY_VIDEO_PORT });
    mgr.disconnectFromMenu();
    expect(hosts[0].stopCalls).toBe(1);
    hosts[0].exit({ reason: 'stop-requested' });
    expect(sessionMsgs(sent).at(-1)).toEqual({ kind: 'displaySession', active: false, sessionId: 'sess-1', videoPort: null, reason: 'mac-disconnect' });
  });

  it('routes helper stats and log events to the log, never the token', () => {
    const { mgr, hosts, logs } = setup();
    mgr.handleStartRequest(START);
    hosts[0].emit({ evt: 'log', level: 'warn', message: 'capture restarted' });
    hosts[0].emit({ evt: 'stats', fps: 60, kbps: 8000, unacked: 1, ackP50Ms: 9, ackP95Ms: 20, phoneRendered: 300, phoneDropped: 2 });
    expect(logs).toContainEqual({ level: 'warn', message: 'capture restarted' });
    expect(logs.some((l) => l.message.includes('fps 60'))).toBe(true);
    hosts[0].exit({ reason: 'helper-crashed' });
    expect(logs.some((l) => l.message.includes('tok1'))).toBe(false);
  });

  it('generates tokens core accepts by default', () => {
    const hosts: HelperStartCommand[] = [];
    const sent: ToCore[] = [];
    const mgr = new DisplaySessionManager({
      createHost: (h) => ({ start: (c) => { hosts.push(c); h.onSpawn(); }, stop: () => {}, isRunning: () => true }),
      sendToCore: (m) => sent.push(m),
      getIds: () => ({ vendorId: 1, productId: 2 }),
      isSupportedMacOS: () => true,
      onLog: () => {},
    });
    mgr.handleStartRequest(START);
    const tokenMsg = sent[0] as Extract<ToCore, { kind: 'displayToken' }>;
    expect(tokenMsg.token).toMatch(/^[A-Za-z0-9-]{1,128}$/);
    expect(tokenMsg.token.length).toBeGreaterThanOrEqual(32);
    expect(tokenMsg.sessionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('refuses a start whose token core would reject, without spawning', () => {
    const { mgr, hosts, sent } = setup({ randomToken: () => 'bad token;rm' });
    mgr.handleStartRequest(START);
    expect(hosts).toHaveLength(0);
    expect(sent.some((m) => m.kind === 'displayToken')).toBe(false);
  });

  it('shutdown stops the current session and drops a queued start', () => {
    const { mgr, hosts } = setup();
    mgr.handleStartRequest(START);
    mgr.handleStartRequest({ ...START, w: 1000 });
    mgr.shutdown();
    hosts[0].exit({ reason: 'stop-requested' });
    expect(hosts).toHaveLength(1);
    mgr.handleStartRequest(START);
    expect(hosts).toHaveLength(1);
  });

  it('ignores ready from a helper that is already being stopped (superseded before ready)', () => {
    const { mgr, hosts, sent, logs } = setup();
    mgr.handleStartRequest(START);
    mgr.handleStartRequest({ ...START, w: 1000 });
    hosts[0].emit({ evt: 'ready', displayId: 7, port: DISPLAY_VIDEO_PORT });
    expect(sent.some((m) => m.kind === 'displaySession' && m.active)).toBe(false);
    expect(mgr.isActive()).toBe(false);
    expect(logs.some((l) => l.message.includes('ignoring ready'))).toBe(true);

    hosts[0].exit({ reason: 'stop-requested' });
    expect(sessionMsgs(sent)).toEqual([{ kind: 'displaySession', active: false, sessionId: 'sess-1', videoPort: null, reason: 'superseded' }]);
    expect(hosts).toHaveLength(2);
    hosts[1].emit({ evt: 'ready', displayId: 8, port: DISPLAY_VIDEO_PORT });
    expect(sessionMsgs(sent).at(-1)).toEqual({ kind: 'displaySession', active: true, sessionId: 'sess-2', videoPort: DISPLAY_VIDEO_PORT });
  });

  it('skips the resync for a session that is being stopped', () => {
    const { mgr, hosts, sent } = setup();
    mgr.handleStartRequest(START);
    hosts[0].emit({ evt: 'ready', displayId: 7, port: DISPLAY_VIDEO_PORT });
    mgr.handleStopRequest({ sessionId: 'sess-1', reason: 'user-exit' });
    sent.length = 0;
    mgr.onCoreRunning();
    mgr.onCoreSnapshot();
    expect(sent).toEqual([]);
  });

  it('does not call onChange once shutting down (the tray may be destroyed)', () => {
    const { mgr, hosts, onChange } = setup();
    mgr.handleStartRequest(START);
    hosts[0].emit({ evt: 'ready', displayId: 7, port: DISPLAY_VIDEO_PORT });
    mgr.shutdown();
    onChange.mockClear();
    hosts[0].exit({ reason: 'stop-requested' });
    expect(onChange).not.toHaveBeenCalled();
  });

  describe('dev token file', () => {
    let dir: string;
    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'da-token-'));
    });
    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('writes the dev token file with mode 0600 only when configured', () => {
      const file = path.join(dir, 'token');
      const { mgr, hosts } = setup({ devTokenFile: file });
      mgr.handleStartRequest(START);
      expect(fs.readFileSync(file, 'utf8')).toBe('tok1');
      expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      hosts[0].exit({ reason: 'phone-bye' });
      expect(fs.existsSync(file)).toBe(false);

      const other = setup({ devTokenFile: null });
      other.mgr.handleStartRequest(START);
      expect(fs.readdirSync(dir)).toEqual([]);
    });
  });
});
