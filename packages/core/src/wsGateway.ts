import { WebSocketServer, WebSocket } from 'ws';
import { parseFrame, createFrame, type WidgetEntry, type Widget } from '@desk-agent/protocol';
import type { LogLevel } from '@desk-agent/plugin-sdk';

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
  /** Included only in the hello-reply snapshot, never a later single-widget push -- see WidgetUpdatePayloadSchema's comment on why "absent" means "no visibility change", not "hide everything". */
  getVisibleWidgets?: () => string[];
  onEventPublish: (raw: unknown) => void;
  /** Invoked when a client sends an action.invoke frame (e.g. media transport buttons). */
  onActionInvoke?: (pluginId: string, action: string, args?: Record<string, unknown>) => void;
  /** Invoked once per successfully-parsed inbound frame, of any type — a liveness signal for the watchdog. */
  onClientMessage?: () => void;
  onLog?: (level: LogLevel, message: string) => void;
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
  private lastHelloAt: number | null = null;

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

  getClientCount(): number {
    return this.clients.size;
  }

  getLastHelloAt(): number | null {
    return this.lastHelloAt;
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
      this.lastHelloAt = Date.now();
      const widgets = await this.opts.getSnapshot();
      const visibleWidgets = this.opts.getVisibleWidgets?.();
      client.send(JSON.stringify(createFrame('widget.update', { widgets, ...(visibleWidgets ? { visibleWidgets } : {}) })));
    } else if (frame.type === 'event.publish') {
      this.opts.onEventPublish(frame.payload);
    } else if (frame.type === 'action.invoke') {
      const { pluginId, action, args } = frame.payload;
      this.opts.onActionInvoke?.(pluginId, action, args);
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
