import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { WsGateway } from './index.js';
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

  it('forwards action.invoke to onActionInvoke with pluginId, action, and args', () => {
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
});
