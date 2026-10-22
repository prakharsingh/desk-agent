import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { WsGateway, isAllowedGatewayClient } from './index.js';
import { createFrame, type Frame } from '@desk-agent/protocol';
import type { WsClientLike, WsServerLike } from './index.js';

class FakeClient extends EventEmitter implements WsClientLike {
  sent: string[] = [];
  send(data: string) { this.sent.push(data); }
}

class FakeServer extends EventEmitter implements WsServerLike {
  close() {}
}

function connectClient(server: FakeServer): FakeClient {
  const client = new FakeClient();
  server.emit('connection', client);
  return client;
}

describe('WsGateway', () => {
  it('replies to hello with one widget.update frame carrying the full atomic snapshot', async () => {
    const server = new FakeServer();
    const snapshot = [{ widgetId: 'system-stats', widget: { type: 'system-stats', props: { cpu: 1 } } }];
    const gateway = new WsGateway({
      port: 8787, heartbeatMs: 5000,
      getSnapshot: async () => snapshot,
      onEventPublish: vi.fn(),
      wssFactory: () => server,
    });
    gateway.start();
    const client = connectClient(server);
    client.emit('message', JSON.stringify(createFrame('hello', { clientVersion: '1.0.0' })));
    await vi.waitFor(() => expect(client.sent.length).toBe(1));
    const reply: Frame = JSON.parse(client.sent[0]);
    expect(reply.type).toBe('widget.update');
    expect((reply.payload as any).widgets).toEqual(snapshot);
  });

  it('includes visibleWidgets in the hello-reply when getVisibleWidgets is provided', async () => {
    const server = new FakeServer();
    const gateway = new WsGateway({
      port: 8787, heartbeatMs: 5000,
      getSnapshot: async () => [],
      getVisibleWidgets: () => ['clock', 'weather'],
      onEventPublish: vi.fn(),
      wssFactory: () => server,
    });
    gateway.start();
    const client = connectClient(server);
    client.emit('message', JSON.stringify(createFrame('hello', { clientVersion: '1.0.0' })));
    await vi.waitFor(() => expect(client.sent.length).toBe(1));
    const reply: Frame = JSON.parse(client.sent[0]);
    expect((reply.payload as any).visibleWidgets).toEqual(['clock', 'weather']);
  });

  it('omits visibleWidgets from the hello-reply when getVisibleWidgets is not provided', async () => {
    const server = new FakeServer();
    const gateway = new WsGateway({
      port: 8787, heartbeatMs: 5000,
      getSnapshot: async () => [],
      onEventPublish: vi.fn(),
      wssFactory: () => server,
    });
    gateway.start();
    const client = connectClient(server);
    client.emit('message', JSON.stringify(createFrame('hello', { clientVersion: '1.0.0' })));
    await vi.waitFor(() => expect(client.sent.length).toBe(1));
    const reply: Frame = JSON.parse(client.sent[0]);
    expect((reply.payload as any).visibleWidgets).toBeUndefined();
  });

  it('does not include visibleWidgets on a later single-widget push update (broadcastWidgetUpdate)', () => {
    const server = new FakeServer();
    const gateway = new WsGateway({
      port: 8787, heartbeatMs: 5000,
      getSnapshot: async () => [],
      getVisibleWidgets: () => ['clock'],
      onEventPublish: vi.fn(),
      wssFactory: () => server,
    });
    gateway.start();
    const client = connectClient(server);
    gateway.broadcastWidgetUpdate('weather', { type: 'weather', props: {} });
    const frame: Frame = JSON.parse(client.sent[0]);
    expect((frame.payload as any).visibleWidgets).toBeUndefined();
  });

  it('forwards event.publish payload to onEventPublish', () => {
    const server = new FakeServer();
    const onEventPublish = vi.fn();
    const gateway = new WsGateway({
      port: 8787, heartbeatMs: 5000,
      getSnapshot: async () => [],
      onEventPublish,
      wssFactory: () => server,
    });
    gateway.start();
    const client = connectClient(server);
    client.emit('message', JSON.stringify(createFrame('event.publish', { eventName: 'person_present', data: { present: false } })));
    expect(onEventPublish).toHaveBeenCalledWith({ eventName: 'person_present', data: { present: false } });
  });

  it('forwards action.invoke payload to onActionInvoke', () => {
    const server = new FakeServer();
    const onActionInvoke = vi.fn();
    const gateway = new WsGateway({
      port: 8787, heartbeatMs: 5000,
      getSnapshot: async () => [],
      onEventPublish: vi.fn(),
      onActionInvoke,
      wssFactory: () => server,
    });
    gateway.start();
    const client = connectClient(server);
    client.emit('message', JSON.stringify(createFrame('action.invoke', { pluginId: 'system-stats', action: 'togglePlayPause' })));
    expect(onActionInvoke).toHaveBeenCalledWith('system-stats', 'togglePlayPause', undefined);
  });

  it('does not throw on action.invoke when onActionInvoke is not provided', () => {
    const server = new FakeServer();
    const gateway = new WsGateway({
      port: 8787, heartbeatMs: 5000, getSnapshot: async () => [], onEventPublish: vi.fn(), wssFactory: () => server,
    });
    gateway.start();
    const client = connectClient(server);
    expect(() => {
      client.emit('message', JSON.stringify(createFrame('action.invoke', { pluginId: 'system-stats', action: 'next' })));
    }).not.toThrow();
  });

  it('drops a malformed frame without throwing', () => {
    const server = new FakeServer();
    const gateway = new WsGateway({
      port: 8787, heartbeatMs: 5000, getSnapshot: async () => [], onEventPublish: vi.fn(), wssFactory: () => server,
    });
    gateway.start();
    const client = connectClient(server);
    expect(() => client.emit('message', 'not json')).not.toThrow();
    expect(client.sent).toEqual([]);
  });

  it('invokes onClientMessage once when a valid frame arrives, regardless of frame type', () => {
    const server = new FakeServer();
    const onClientMessage = vi.fn();
    const gateway = new WsGateway({
      port: 8787, heartbeatMs: 5000, getSnapshot: async () => [], onEventPublish: vi.fn(), wssFactory: () => server,
      onClientMessage,
    });
    gateway.start();
    const client = connectClient(server);
    client.emit('message', JSON.stringify(createFrame('heartbeat', {})));
    expect(onClientMessage).toHaveBeenCalledTimes(1);
  });

  it('does not invoke onClientMessage when a malformed frame arrives', () => {
    const server = new FakeServer();
    const onClientMessage = vi.fn();
    const gateway = new WsGateway({
      port: 8787, heartbeatMs: 5000, getSnapshot: async () => [], onEventPublish: vi.fn(), wssFactory: () => server,
      onClientMessage,
    });
    gateway.start();
    const client = connectClient(server);
    client.emit('message', 'not json');
    expect(onClientMessage).not.toHaveBeenCalled();
  });

  it('serves a client that connected before start() was called', async () => {
    const server = new FakeServer();
    const snapshot = [{ widgetId: 'system-stats', widget: { type: 'system-stats', props: { cpu: 1 } } }];
    const gateway = new WsGateway({
      port: 8787, heartbeatMs: 5000,
      getSnapshot: async () => snapshot,
      onEventPublish: vi.fn(),
      wssFactory: () => server,
    });
    // The real WebSocketServer starts listening in the constructor, so a phone
    // can connect during the worker-startup window before gateway.start().
    const client = connectClient(server);
    client.emit('message', JSON.stringify(createFrame('hello', { clientVersion: '1.0.0' })));
    await vi.waitFor(() => expect(client.sent.length).toBe(1));
    gateway.start();
    gateway.stop();
  });

  it('logs a server error (e.g. port already in use) instead of crashing', () => {
    const server = new FakeServer();
    const onLog = vi.fn();
    new WsGateway({
      port: 8787, heartbeatMs: 5000, getSnapshot: async () => [], onEventPublish: vi.fn(), wssFactory: () => server,
      onLog,
    });
    expect(() => server.emit('error', new Error('listen EADDRINUSE: address already in use 127.0.0.1:8787'))).not.toThrow();
    expect(onLog).toHaveBeenCalledWith('error', expect.stringContaining('EADDRINUSE'));
  });

  describe('getClientCount/getLastHelloAt (Phase 3 state-surface: Overview/Device "paired phone")', () => {
    it('starts at zero connected clients and no hello yet', () => {
      const server = new FakeServer();
      const gateway = new WsGateway({
        port: 8787, heartbeatMs: 5000, getSnapshot: async () => [], onEventPublish: vi.fn(), wssFactory: () => server,
      });
      expect(gateway.getClientCount()).toBe(0);
      expect(gateway.getLastHelloAt()).toBeNull();
    });

    it('counts connected clients and decrements on close', () => {
      const server = new FakeServer();
      const gateway = new WsGateway({
        port: 8787, heartbeatMs: 5000, getSnapshot: async () => [], onEventPublish: vi.fn(), wssFactory: () => server,
      });
      gateway.start();
      const client1 = connectClient(server);
      expect(gateway.getClientCount()).toBe(1);
      connectClient(server);
      expect(gateway.getClientCount()).toBe(2);
      client1.emit('close');
      expect(gateway.getClientCount()).toBe(1);
    });

    it('reports every connected-client count change via onClientCountChange (connect and close)', () => {
      const server = new FakeServer();
      const onClientCountChange = vi.fn();
      new WsGateway({
        port: 8787, heartbeatMs: 5000, getSnapshot: async () => [], onEventPublish: vi.fn(), wssFactory: () => server, onClientCountChange,
      });
      const client1 = connectClient(server);
      const client2 = connectClient(server);
      client1.emit('close');
      client2.emit('close');
      expect(onClientCountChange.mock.calls.map(([n]) => n)).toEqual([1, 2, 1, 0]);
    });

    it('records the timestamp of the most recent hello frame', async () => {
      const server = new FakeServer();
      const snapshot = [{ widgetId: 'system-stats', widget: { type: 'system-stats', props: { cpu: 1 } } }];
      const gateway = new WsGateway({
        port: 8787, heartbeatMs: 5000, getSnapshot: async () => snapshot, onEventPublish: vi.fn(), wssFactory: () => server,
      });
      gateway.start();
      const client = connectClient(server);
      client.emit('message', JSON.stringify(createFrame('hello', { clientVersion: '1.0.0' })));
      await vi.waitFor(() => expect(gateway.getLastHelloAt()).toEqual(expect.any(Number)));
    });
  });

  it('broadcastWidgetUpdate sends a single-entry widgets array to all clients', () => {
    const server = new FakeServer();
    const gateway = new WsGateway({
      port: 8787, heartbeatMs: 5000, getSnapshot: async () => [], onEventPublish: vi.fn(), wssFactory: () => server,
    });
    gateway.start();
    const client = connectClient(server);
    gateway.broadcastWidgetUpdate('weather', { type: 'weather', props: { tempF: 70 } });
    const frame: Frame = JSON.parse(client.sent[0]);
    expect(frame.type).toBe('widget.update');
    expect((frame.payload as any).widgets).toEqual([{ widgetId: 'weather', widget: { type: 'weather', props: { tempF: 70 } } }]);
  });

  it('sendScreensaverConfig broadcasts an action.invoke frame targeting the phone (pluginId: phone-display)', () => {
    const server = new FakeServer();
    const gateway = new WsGateway({
      port: 8787, heartbeatMs: 5000, getSnapshot: async () => [], onEventPublish: vi.fn(), wssFactory: () => server,
    });
    gateway.start();
    const client = connectClient(server);
    gateway.sendScreensaverConfig({ enabled: false, graceMs: 60000 });
    const frame: Frame = JSON.parse(client.sent[0]);
    expect(frame.type).toBe('action.invoke');
    expect(frame.payload).toEqual({
      pluginId: 'phone-display',
      action: 'setScreensaverConfig',
      args: { enabled: false, graceMs: 60000 },
    });
  });

  it('sendScreensaverConfig sends to every connected client', () => {
    const server = new FakeServer();
    const gateway = new WsGateway({
      port: 8787, heartbeatMs: 5000, getSnapshot: async () => [], onEventPublish: vi.fn(), wssFactory: () => server,
    });
    gateway.start();
    const client1 = connectClient(server);
    const client2 = connectClient(server);
    gateway.sendScreensaverConfig({ enabled: true, graceMs: 120000 });
    expect(client1.sent).toHaveLength(1);
    expect(client2.sent).toHaveLength(1);
  });
});

describe('WsGateway presence settings (camera / wake)', () => {
  it('sendCameraEnabled broadcasts action.invoke phone-display/setCameraEnabled', () => {
    const server = new FakeServer();
    const gateway = new WsGateway({ port: 8787, heartbeatMs: 5000, getSnapshot: async () => [], onEventPublish: vi.fn(), wssFactory: () => server });
    gateway.start();
    const a = connectClient(server);
    const b = connectClient(server);
    gateway.sendCameraEnabled(true);
    for (const c of [a, b]) {
      const frame: Frame = JSON.parse(c.sent[0]);
      expect(frame.type).toBe('action.invoke');
      expect(frame.payload).toEqual({ pluginId: 'phone-display', action: 'setCameraEnabled', args: { enabled: true } });
    }
    gateway.stop();
  });

  it('sendWakeEnabled broadcasts action.invoke phone-display/setWakeEnabled', () => {
    const server = new FakeServer();
    const gateway = new WsGateway({ port: 8787, heartbeatMs: 5000, getSnapshot: async () => [], onEventPublish: vi.fn(), wssFactory: () => server });
    gateway.start();
    const client = connectClient(server);
    gateway.sendWakeEnabled(false);
    const frame: Frame = JSON.parse(client.sent[0]);
    expect(frame.payload).toEqual({ pluginId: 'phone-display', action: 'setWakeEnabled', args: { enabled: false } });
    gateway.stop();
  });

  it('on hello, sends the current wakeEnabled to that client right after the widget.update snapshot', async () => {
    const server = new FakeServer();
    let wake = true;
    const gateway = new WsGateway({
      port: 8787, heartbeatMs: 5000, getSnapshot: async () => [], onEventPublish: vi.fn(), wssFactory: () => server,
      getWakeEnabled: () => wake,
    });
    gateway.start();
    const other = connectClient(server);
    const client = connectClient(server);
    wake = false;
    client.emit('message', JSON.stringify(createFrame('hello', { clientVersion: '1.0.0' })));
    await vi.waitFor(() => expect(client.sent.length).toBe(2));
    expect(JSON.parse(client.sent[0]).type).toBe('widget.update');
    expect(JSON.parse(client.sent[1]).payload).toEqual({ pluginId: 'phone-display', action: 'setWakeEnabled', args: { enabled: false } });
    expect(other.sent).toHaveLength(0);
    gateway.stop();
  });
});

describe('WsGateway client verification (Origin)', () => {
  it.each([
    ['no Origin header (Node/ws, native clients)', undefined, '127.0.0.1:8787', true],
    ["RN Android's default origin derived from ws://localhost:8787", 'http://localhost:8787', 'localhost:8787', true],
    ['same-origin 127.0.0.1', 'http://127.0.0.1:8787', '127.0.0.1:8787', true],
    ['a browser page on another site', 'https://evil.example', 'localhost:8787', false],
    ['a browser page on another localhost port', 'http://localhost:3000', 'localhost:8787', false],
    ['a sandboxed/file page ("null")', 'null', 'localhost:8787', false],
    ['DNS rebinding (Host is the attacker name)', 'http://evil.example:8787', 'evil.example:8787', false],
    ['an Origin with no Host header', 'http://localhost:8787', undefined, false],
    ['garbage Origin', 'not a url', 'localhost:8787', false],
  ] as const)('%s -> %s', (_label, origin, host, allowed) => {
    expect(isAllowedGatewayClient(origin, host)).toBe(allowed);
  });

  it('the real WebSocketServer rejects a browser-Origin connection and accepts the phone/native ones', async () => {
    const { WebSocket } = await import('ws');
    const net = await import('node:net');
    const port: number = await new Promise((resolve) => {
      const srv = net.createServer().listen(0, '127.0.0.1', () => {
        const p = (srv.address() as import('node:net').AddressInfo).port;
        srv.close(() => resolve(p));
      });
    });
    const gateway = new WsGateway({ port, heartbeatMs: 60_000, getSnapshot: async () => [], onEventPublish: vi.fn() });
    const attempt = (headers: Record<string, string>, url = `ws://127.0.0.1:${port}`) =>
      new Promise<'open' | number>((resolve) => {
        const ws = new WebSocket(url, { headers });
        ws.on('open', () => { ws.close(); resolve('open'); });
        ws.on('unexpected-response', (_req, res) => { resolve(res.statusCode ?? -1); ws.terminate(); });
        ws.on('error', () => {});
      });
    try {
      await vi.waitFor(async () => expect(await attempt({})).toBe('open'));
      expect(await attempt({ Origin: 'https://evil.example' })).toBe(403);
      // Exactly the headers RN's OkHttp sends for ws://localhost:<port>.
      expect(await attempt({ Host: `localhost:${port}`, Origin: `http://localhost:${port}` })).toBe('open');
    } finally {
      gateway.stop();
    }
  });
});

