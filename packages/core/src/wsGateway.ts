import { WebSocketServer, WebSocket } from 'ws';
import { parseFrame, createFrame, type WidgetEntry, type Widget } from '@desk-agent/protocol';

export interface WsClientLike {
  send(data: string): void;
  on(event: 'message' | 'close', handler: (...args: any[]) => void): void;
}

export interface WsServerLike {
  on(event: 'connection', handler: (client: WsClientLike) => void): void;
  on(event: 'error', handler: (err: Error) => void): void;
  close(): void;
}

export interface WsGatewayOptions {
  port: number;
  heartbeatMs: number;
  getSnapshot: () => Promise<WidgetEntry[]>;
  onEventPublish: (raw: unknown) => void;
  /** Invoked once per successfully-parsed inbound frame, of any type — a liveness signal for the watchdog. */
  onClientMessage?: () => void;
  onLog?: (level: string, message: string) => void;
  wssFactory?: () => WsServerLike;
}

function defaultWssFactory(port: number): WsServerLike {
  return new WebSocketServer({ host: '127.0.0.1', port }) as unknown as WsServerLike;
}

function safeJsonParse(raw: unknown): unknown {
  try {
    return JSON.parse(String(raw));
  } catch {
    return null;
  }
}

export class WsGateway {
  private wss: WsServerLike;
  private clients = new Set<WsClientLike>();
  private heartbeatTimer?: NodeJS.Timeout;

  constructor(private opts: WsGatewayOptions) {
    this.wss = opts.wssFactory ? opts.wssFactory() : defaultWssFactory(opts.port);
    // The underlying WebSocketServer starts listening as soon as it's
    // constructed, so both handlers must be attached here, not in start():
    // an unhandled 'error' (e.g. EADDRINUSE) is an uncaught exception, and a
    // client connecting during the worker-startup window before start()
    // would otherwise be silently ignored until its heartbeat timeout.
    this.wss.on('error', (err) => this.opts.onLog?.('error', `websocket server error: ${String(err)}`));
    this.wss.on('connection', (client) => this.handleConnection(client));
  }

  start() {
    this.heartbeatTimer = setInterval(() => this.broadcastHeartbeat(), this.opts.heartbeatMs);
  }

  stop() {
    clearInterval(this.heartbeatTimer);
    this.wss.close();
  }

  private handleConnection(client: WsClientLike) {
    this.clients.add(client);
    client.on('message', (raw) => this.handleMessage(client, raw));
    client.on('close', () => this.clients.delete(client));
  }

  private async handleMessage(client: WsClientLike, raw: unknown) {
    const parsed = parseFrame(safeJsonParse(raw));
    if (!parsed.ok) return;
    this.opts.onClientMessage?.();
    const frame = parsed.value;
    if (frame.type === 'hello') {
      const widgets = await this.opts.getSnapshot();
      client.send(JSON.stringify(createFrame('widget.update', { widgets })));
    } else if (frame.type === 'event.publish') {
      this.opts.onEventPublish(frame.payload);
    }
  }

  broadcastWidgetUpdate(widgetId: string, widget: Widget) {
    const frame = createFrame('widget.update', { widgets: [{ widgetId, widget }] });
    for (const client of this.clients) client.send(JSON.stringify(frame));
  }

  private broadcastHeartbeat() {
    const frame = createFrame('heartbeat', {});
    for (const client of this.clients) client.send(JSON.stringify(frame));
  }
}
