import { parseFrame, createFrame, type Frame } from '@desk-agent/protocol';

export type ConnectionState = 'connecting' | 'connected' | 'tunnel-down' | 'server-down';

export interface SocketLike {
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
      if (parsed.ok) this.opts.onFrame(parsed.value);
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

  send(json: string): void {
    this.socket?.send(json);
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
