import { parseFrame, createFrame, type Frame } from '@desk-agent/protocol';

export type ConnectionState = 'connecting' | 'connected' | 'tunnel-down' | 'server-down';

// Mirrors the standard WebSocket readyState values (WebSocket.CONNECTING = 0,
// WebSocket.OPEN = 1, WebSocket.CLOSING = 2, WebSocket.CLOSED = 3).
export const enum SocketReadyState {
  CONNECTING = 0,
  OPEN = 1,
  CLOSING = 2,
  CLOSED = 3,
}

export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: (() => void) | null;
}

export interface WsClientOptions {
  url: string;
  onFrame: (frame: Frame) => void;
  onStateChange: (state: ConnectionState) => void;
  heartbeatTimeoutMs: number;
  socketFactory?: () => SocketLike;
}

const MAX_BACKOFF_MS = 30000;

export function nextBackoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
}

function defaultSocketFactory(url: string): SocketLike {
  return new WebSocket(url) as unknown as SocketLike;
}

export class WsClient {
  private socket: SocketLike | null = null;
  private hasOpened = false;
  private attempt = 0;
  private heartbeatTimer?: ReturnType<typeof setTimeout>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private stopped = false;

  constructor(private opts: WsClientOptions) {}

  connect() {
    this.stopped = false;
    this.hasOpened = false;
    this.opts.onStateChange('connecting');
    this.socket = this.opts.socketFactory ? this.opts.socketFactory() : defaultSocketFactory(this.opts.url);
    this.socket.onopen = () => {
      this.hasOpened = true;
      this.attempt = 0;
      this.opts.onStateChange('connected');
      this.resetHeartbeatDeadline();
      this.socket!.send(JSON.stringify(createFrame('hello', { clientVersion: '1.0.0' })));
    };
    this.socket.onmessage = (event) => {
      if (this.stopped) return;
      this.resetHeartbeatDeadline();
      const parsed = parseFrame(JSON.parse(event.data));
      if (!parsed.ok) return;
      if (parsed.value.type === 'heartbeat') {
        // Ack the server's periodic heartbeat (WsGateway.broadcastHeartbeat,
        // every heartbeatMs) so the Mac's Watchdog sees regular client->
        // server liveness traffic even when nothing else is happening --
        // e.g. during a genuine, unchanging absence, when sensor edges (edge
        // -only emission) legitimately stop firing entirely. Without this,
        // the phone could go silent client->server for the whole absence
        // window, and the Mac's much-shorter watchdog timeout would
        // repeatedly mistake that silence for a dead link, forcing presence
        // back to "present" every time and preventing the display from ever
        // auto-sleeping (see main.ts's Watchdog wiring and
        // presenceEngine.ts's onLinkResumed).
        this.send(JSON.stringify(createFrame('heartbeat', {})));
      }
      this.opts.onFrame(parsed.value);
    };
    this.socket.onclose = () => this.handleDrop(this.hasOpened ? 'server-down' : 'tunnel-down');
    this.socket.onerror = () => {};
  }

  disconnect() {
    this.stopped = true;
    clearTimeout(this.heartbeatTimer);
    clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = null;
  }

  // Silently drops the frame if the socket isn't OPEN yet (or anymore),
  // rather than queuing it. A real WebSocket.send() throws INVALID_STATE_ERR
  // synchronously when called while still CONNECTING, which crashed the app
  // on cold launch (CameraPresence announces camera_state from a mount-time
  // effect that can race ahead of WsClient.connect() actually opening).
  // Queuing was considered but rejected: callers like CameraPresence already
  // re-announce their current state via `connectionEpoch` on every
  // reconnect/resync, so a dropped early frame self-heals on the very next
  // connection -- no message that matters here is ever truly lost. This
  // matches the rest of the codebase's "not ready yet" philosophy (e.g.
  // WorkerHost drops in-flight requests rather than replaying them across a
  // reconnect) rather than introducing a new buffering mechanism.
  send(json: string): void {
    if (this.socket?.readyState !== SocketReadyState.OPEN) return;
    this.socket.send(json);
  }

  private resetHeartbeatDeadline() {
    clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = setTimeout(() => this.handleDrop('server-down'), this.opts.heartbeatTimeoutMs);
  }

  private handleDrop(reason: ConnectionState) {
    if (this.stopped) return;
    clearTimeout(this.heartbeatTimer);
    this.opts.onStateChange(reason);
    const backoff = nextBackoffMs(this.attempt++);
    this.reconnectTimer = setTimeout(() => this.connect(), backoff);
  }
}
