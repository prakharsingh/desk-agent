import { WebSocketServer, WebSocket } from 'ws';
import {
  parseFrame,
  createFrame,
  PHONE_DISPLAY_PLUGIN_ID,
  SET_CAMERA_ENABLED_ACTION,
  SET_WAKE_ENABLED_ACTION,
  type WidgetEntry,
  type Widget,
  type ScreensaverConfig,
} from '@desk-agent/protocol';
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
  /** Mac-owned presence.wakeEnabled, sent to a client right after its hello-reply snapshot (action.invoke phone-display/setWakeEnabled) so a freshly (re)connected phone always shows the live value. */
  getWakeEnabled?: () => boolean;
  onEventPublish: (raw: unknown) => void;
  /** Invoked when a client sends an action.invoke frame (e.g. media transport buttons). */
  onActionInvoke?: (pluginId: string, action: string, args?: Record<string, unknown>) => void;
  /** Invoked once per successfully-parsed inbound frame, of any type — a liveness signal for the watchdog. */
  onClientMessage?: () => void;
  /** Invoked with the new connected-client count on every connect and close. */
  onClientCountChange?: (count: number) => void;
  onLog?: (level: LogLevel, message: string) => void;
  wssFactory?: () => WsServerLike;
}

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

// The gateway binds 127.0.0.1 only, but any local browser tab can still open
// ws://127.0.0.1:<port> and publish events (several persist: wake/camera/
// screensaver settings). Browsers always send an Origin header and page JS
// can't forge it, so reject browser origins. Allowed:
// - no Origin: Node/ws and other native clients;
// - Origin exactly `http://<Host header>` on a loopback Host: what React
//   Native Android's OkHttp WebSocket sends by default (WebSocketModule.kt
//   derives origin from the ws:// URL -> http://localhost:8787). No browser
//   page can have that origin (this server serves no pages), and requiring a
//   loopback Host defeats DNS rebinding (Host would be the attacker's name).
export function isAllowedGatewayClient(origin: string | undefined, host: string | undefined): boolean {
  if (origin === undefined || origin === '') return true;
  if (!host) return false;
  try {
    const self = new URL(`http://${host}`);
    if (!LOOPBACK_HOSTNAMES.has(self.hostname)) return false;
    return new URL(origin).origin === self.origin;
  } catch {
    return false;
  }
}

function defaultWssFactory(port: number, onLog?: (level: LogLevel, message: string) => void): WsServerLike {
  return new WebSocketServer({
    host: '127.0.0.1',
    port,
    verifyClient: (info: { origin?: string; req: { headers: Record<string, string | string[] | undefined> } }, done: (ok: boolean, code?: number) => void) => {
      const host = info.req.headers.host;
      const ok = isAllowedGatewayClient(info.origin, typeof host === 'string' ? host : undefined);
      if (!ok) onLog?.('warn', `rejected websocket connection from origin ${JSON.stringify(info.origin)}`);
      done(ok, ok ? undefined : 403);
    },
  }) as unknown as WsServerLike;
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
    this.wss = opts.wssFactory ? opts.wssFactory() : defaultWssFactory(opts.port, opts.onLog);
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
    // Unconditional, device-independent boot signal: every other log source
    // in the core (tunnel supervisor's "re-issued" line, plugin init, worker
    // crashes) only fires given a specific runtime event (a docked phone, a
    // plugin choosing to log, a failure) that a headless/no-hardware
    // environment (e.g. CI) may never produce. Logging the gateway's own
    // "started" transition here guarantees the Logs pane -- and anything
    // observing it, like the e2e suite -- has proof the core actually booted
    // even when nothing else ever logs a line.
    this.opts.onLog?.('info', `gateway listening on 127.0.0.1:${this.opts.port}`);
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
    this.opts.onClientCountChange?.(this.clients.size);
    client.on('message', (raw) => this.handleMessage(client, raw));
    client.on('close', () => {
      if (this.clients.delete(client)) this.opts.onClientCountChange?.(this.clients.size);
    });
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
      if (this.opts.getWakeEnabled) client.send(JSON.stringify(this.wakeEnabledFrame(this.opts.getWakeEnabled())));
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

  // Reserved sentinel pluginId (deliberately absent from resolvePluginRegistry())
  // marks this as a phone-targeted command, not a plugin-worker action -- it
  // never reaches WorkerHost.invokeAction's dispatch, which is keyed by real
  // plugin ids. See docs/superpowers/specs/2026-07-14-phone-screensaver-toggle-design.md.
  sendScreensaverConfig(config: ScreensaverConfig) {
    const frame = createFrame('action.invoke', { pluginId: 'phone-display', action: 'setScreensaverConfig', args: config });
    for (const client of this.clients) client.send(JSON.stringify(frame));
  }

  // Mac -> phone request; the phone applies + persists it and reports the
  // result back via event.publish presence.cameraConfig (phone-owned setting).
  sendCameraEnabled(enabled: boolean) {
    this.broadcast(createFrame('action.invoke', { pluginId: PHONE_DISPLAY_PLUGIN_ID, action: SET_CAMERA_ENABLED_ACTION, args: { enabled } }));
  }

  // Core -> phone push of the Mac-owned wake setting (on every change; the
  // hello path above covers (re)connects).
  sendWakeEnabled(enabled: boolean) {
    this.broadcast(this.wakeEnabledFrame(enabled));
  }

  private wakeEnabledFrame(enabled: boolean) {
    return createFrame('action.invoke', { pluginId: PHONE_DISPLAY_PLUGIN_ID, action: SET_WAKE_ENABLED_ACTION, args: { enabled } });
  }

  private broadcast(frame: ReturnType<typeof createFrame>) {
    const json = JSON.stringify(frame);
    for (const client of this.clients) client.send(json);
  }

  private broadcastHeartbeat() {
    const frame = createFrame('heartbeat', {});
    for (const client of this.clients) client.send(JSON.stringify(frame));
  }
}
