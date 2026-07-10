import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WsClient, nextBackoffMs } from './wsClient.js';
import { createFrame } from '@desk-agent/protocol';

class FakeSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn();
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('nextBackoffMs', () => {
  it('grows exponentially and caps at 30s', () => {
    expect(nextBackoffMs(0)).toBe(1000);
    expect(nextBackoffMs(1)).toBe(2000);
    expect(nextBackoffMs(10)).toBe(30000);
  });
});

describe('WsClient', () => {
  it('reports "connected" once the socket opens and delivers parsed frames', () => {
    let socket!: FakeSocket;
    const onFrame = vi.fn();
    const onStateChange = vi.fn();
    const client = new WsClient({
      url: 'ws://localhost:8787', onFrame, onStateChange, heartbeatTimeoutMs: 10000,
      socketFactory: () => { socket = new FakeSocket(); return socket; },
    });
    client.connect();
    socket.onopen?.();
    expect(onStateChange).toHaveBeenCalledWith('connected');
    socket.onmessage?.({ data: JSON.stringify(createFrame('heartbeat', {})) });
    expect(onFrame).toHaveBeenCalledWith(expect.objectContaining({ type: 'heartbeat' }));
  });

  it('sends a hello frame to the server as soon as the socket opens', () => {
    let socket!: FakeSocket;
    const client = new WsClient({
      url: 'ws://localhost:8787', onFrame: vi.fn(), onStateChange: vi.fn(), heartbeatTimeoutMs: 10000,
      socketFactory: () => { socket = new FakeSocket(); return socket; },
    });
    client.connect();
    expect(socket.send).not.toHaveBeenCalled();
    socket.onopen?.();
    expect(socket.send).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(socket.send.mock.calls[0][0]);
    expect(sent.type).toBe('hello');
    expect(sent.payload).toEqual({ clientVersion: '1.0.0' });
  });

  it('reports "tunnel-down" and retries with backoff when the socket closes before opening', () => {
    let socketCount = 0;
    const sockets: FakeSocket[] = [];
    const onStateChange = vi.fn();
    const client = new WsClient({
      url: 'ws://localhost:8787', onFrame: vi.fn(), onStateChange, heartbeatTimeoutMs: 10000,
      socketFactory: () => { socketCount++; const s = new FakeSocket(); sockets.push(s); return s; },
    });
    client.connect();
    sockets[0].onclose?.({ code: 1006 });
    expect(onStateChange).toHaveBeenCalledWith('tunnel-down');
    vi.advanceTimersByTime(1000);
    expect(socketCount).toBe(2);
  });

  it('reports "server-down" when the socket closes after having opened', () => {
    let socket!: FakeSocket;
    const onStateChange = vi.fn();
    const client = new WsClient({
      url: 'ws://localhost:8787', onFrame: vi.fn(), onStateChange, heartbeatTimeoutMs: 10000,
      socketFactory: () => { socket = new FakeSocket(); return socket; },
    });
    client.connect();
    socket.onopen?.();
    socket.onclose?.({ code: 1006 });
    expect(onStateChange).toHaveBeenCalledWith('server-down');
  });

  it('reports "server-down" on a heartbeat gap even without a close event', () => {
    let socket!: FakeSocket;
    const onStateChange = vi.fn();
    const client = new WsClient({
      url: 'ws://localhost:8787', onFrame: vi.fn(), onStateChange, heartbeatTimeoutMs: 5000,
      socketFactory: () => { socket = new FakeSocket(); return socket; },
    });
    client.connect();
    socket.onopen?.();
    vi.advanceTimersByTime(5000);
    expect(onStateChange).toHaveBeenCalledWith('server-down');
  });

  it('disconnect() stops all pending timers and prevents any further reconnect attempts', () => {
    let socket!: FakeSocket;
    let socketCount = 0;
    const onStateChange = vi.fn();
    const client = new WsClient({
      url: 'ws://localhost:8787', onFrame: vi.fn(), onStateChange, heartbeatTimeoutMs: 10000,
      socketFactory: () => { socketCount++; socket = new FakeSocket(); return socket; },
    });
    client.connect();
    socket.onopen?.();
    client.disconnect();

    // Simulate a late/in-flight close event arriving after disconnect.
    socket.onclose?.({ code: 1006 });
    expect(socketCount).toBe(1);
    expect(onStateChange).not.toHaveBeenCalledWith('tunnel-down');
    expect(onStateChange).not.toHaveBeenCalledWith('server-down');

    // Advancing well past the reconnect backoff window must not create a new socket.
    vi.advanceTimersByTime(30000);
    expect(socketCount).toBe(1);
  });

  it('does not deliver frames or re-arm timers for messages arriving after disconnect()', () => {
    let socket!: FakeSocket;
    const onFrame = vi.fn();
    const onStateChange = vi.fn();
    const client = new WsClient({
      url: 'ws://localhost:8787', onFrame, onStateChange, heartbeatTimeoutMs: 10000,
      socketFactory: () => { socket = new FakeSocket(); return socket; },
    });
    client.connect();
    socket.onopen?.();
    client.disconnect();

    socket.onmessage?.({ data: JSON.stringify(createFrame('heartbeat', {})) });
    expect(onFrame).not.toHaveBeenCalled();
  });

  it('send() forwards the raw JSON string to the underlying socket once connected', () => {
    let socket!: FakeSocket;
    const client = new WsClient({
      url: 'ws://localhost:8787', onFrame: vi.fn(), onStateChange: vi.fn(), heartbeatTimeoutMs: 10000,
      socketFactory: () => { socket = new FakeSocket(); return socket; },
    });
    client.connect();
    socket.onopen?.();
    client.send('{"foo":"bar"}');
    expect(socket.send).toHaveBeenCalledWith('{"foo":"bar"}');
  });

  it('send() does not throw when called before ever connecting', () => {
    const client = new WsClient({
      url: 'ws://localhost:8787', onFrame: vi.fn(), onStateChange: vi.fn(), heartbeatTimeoutMs: 10000,
    });
    expect(() => client.send('{"foo":"bar"}')).not.toThrow();
  });

  it('send() does not throw when called after disconnect()', () => {
    let socket!: FakeSocket;
    const client = new WsClient({
      url: 'ws://localhost:8787', onFrame: vi.fn(), onStateChange: vi.fn(), heartbeatTimeoutMs: 10000,
      socketFactory: () => { socket = new FakeSocket(); return socket; },
    });
    client.connect();
    socket.onopen?.();
    client.disconnect();
    expect(() => client.send('{"foo":"bar"}')).not.toThrow();
  });
});
