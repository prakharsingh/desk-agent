import type { LogLevel, Permission } from '@desk-agent/plugin-sdk';
import type { PresenceState } from './presenceEngine.js';
import type { AutomationRuleView } from './automationEngine.js';
import type { TunnelStatusSnapshot } from './tunnelSupervisor.js';
import type { ScreensaverConfig, CameraConfig, DisplayOrientation, DisplayReason } from '@desk-agent/protocol';
import type { WakeChangeSource } from './wakeSetting.js';

export interface LogEntry {
  ts: number;
  level: LogLevel;
  source: string;
  message: string;
}

export interface StatusSnapshot {
  core: { uptimeMs: number; wsPort: number; watchdogTimeoutMs: number };
  device: TunnelStatusSnapshot;
  clients: { connected: number; lastHelloAt: number | null };
  presence: { state: PresenceState; since: number };
  plugins: Record<string, { enabled: boolean; permissions: Permission[] }>;
  automation: { enabled: boolean; rules: AutomationRuleView[] };
  denialsToday: number;
  // null until the phone has connected and reported its config at least
  // once, ever -- see ScreensaverConfigStore's doc comment.
  screensaver: ScreensaverConfig | null;
  // Phone-owned camera-presence setting; null until the phone has reported
  // it at least once (see CameraConfigStore).
  camera: CameraConfig | null;
}

export type ToApp =
  | { kind: 'snapshot'; data: StatusSnapshot }
  | { kind: 'log'; entry: LogEntry }
  // Core applied a Monitor wake change (from the phone OR the Mac -- core is
  // the serialization point, see wakeSetting.ts). The Mac main process
  // persists core's latest reported value to config.json (no core restart).
  | { kind: 'wakeEnabledChanged'; enabled: boolean; source: WakeChangeSource }
  // Extended display (Contract B): the phone asked to start/stop a session.
  // Main owns the helper process; core only relays.
  | { kind: 'displayStartRequest'; w: number; h: number; orientation: DisplayOrientation; deviceSerial: string; dpi?: number }
  | { kind: 'displayStopRequest'; sessionId: string | null; reason: DisplayReason };

// Deliberately narrower than the Phase 0 contract's original draft: it also
// listed `setConfig`/`setPluginEnabled`, written before Phase 2 existed.
// Phase 2 already solved config mutation more robustly -- a validated file
// write plus a full core restart (config changes like enabledPlugins need a
// worker respawn anyway, so live in-process reconfiguration would be a
// second, redundant path to the same outcome). What's left here are the
// genuinely LIVE, no-restart-needed actions: re-issuing the tunnel and
// toggling automation, which don't touch config.json at all.
export type ToCore =
  | { kind: 'getSnapshot' }
  | { kind: 'reissueTunnel' }
  | { kind: 'launchApp' }
  | { kind: 'setLaunchAppOnDock'; enabled: boolean }
  | { kind: 'setAutomationEnabled'; enabled: boolean }
  | { kind: 'setRuleEnabled'; ruleId: string; enabled: boolean }
  | { kind: 'setScreensaverConfig'; enabled: boolean; graceMs: number }
  | { kind: 'setCameraEnabled'; enabled: boolean }
  // Live wake toggle: main has persisted it optimistically; core applies it
  // in memory (no restart), pushes it to the phone, and reports it back
  // (ToApp wakeEnabledChanged) so main converges on core's apply order.
  | { kind: 'setWakeEnabled'; enabled: boolean }
  // Extended display (Contract B). active:false WITH a reason = the session
  // ended (core broadcasts ended/error); WITHOUT one = a silent clear.
  | { kind: 'displaySession'; active: boolean; sessionId: string | null; videoPort: number | null; reason?: DisplayReason }
  // The session token, for core to deliver over adb. Never logged or broadcast.
  | { kind: 'displayToken'; sessionId: string; token: string };

export interface ControlTransport {
  postMessage(msg: ToApp): void;
  onMessage(handler: (msg: ToCore) => void): void;
}

interface GatewayLike {
  getClientCount(): number;
  getLastHelloAt(): number | null;
  sendScreensaverConfig(config: ScreensaverConfig): void;
  sendCameraEnabled(enabled: boolean): void;
}

interface PhoneDisplayLike {
  getStatus(): ScreensaverConfig | null;
}

interface CameraLike {
  getStatus(): CameraConfig | null;
}

interface WakeSettingLike {
  set(enabled: boolean, source: WakeChangeSource): void;
}

// Named extendedDisplay, not phoneDisplay: that dep is the unrelated
// dashboard/screensaver path (PHONE_DISPLAY_PLUGIN_ID).
interface ExtendedDisplayLike {
  onDisplaySession(msg: Omit<Extract<ToCore, { kind: 'displaySession' }>, 'kind'>): unknown;
  onDisplayToken(msg: Omit<Extract<ToCore, { kind: 'displayToken' }>, 'kind'>): unknown;
}

interface TunnelLike {
  getStatus(): TunnelStatusSnapshot;
  reissue(): Promise<void>;
  launchApp(): Promise<void>;
  setLaunchAppOnDock(enabled: boolean): void;
}

interface PresenceLike {
  getState(): PresenceState;
  getStateSince(): number;
}

interface AutomationLike {
  isEnabled(): boolean;
  getRules(): AutomationRuleView[];
  setEnabled(enabled: boolean): void;
  setRuleEnabled(id: string, enabled: boolean): void;
}

export interface ControlChannelDeps {
  transport: ControlTransport;
  gateway: GatewayLike;
  tunnelSupervisor: TunnelLike;
  presenceEngine: PresenceLike;
  automationEngine: AutomationLike;
  phoneDisplay: PhoneDisplayLike;
  camera: CameraLike;
  wakeSetting: WakeSettingLike;
  /** The DisplayCoordinator; absent leaves display messages ignored. */
  extendedDisplay?: ExtendedDisplayLike;
  wsPort: number;
  watchdogTimeoutMs: number;
  /** The full known plugin registry's permission grants, not just the enabled subset -- a disabled plugin's chips should still be visible. */
  pluginPermissions: Record<string, Permission[]>;
  enabledPlugins: string[];
  /** How often to push a fresh snapshot even with no specific mutation, to surface changes no module pushes for yet (device attach/detach, client connect/disconnect). Defaults to 5000ms, matching wsGateway's own heartbeat cadence. */
  snapshotIntervalMs?: number;
}

// The core process's app-facing surface: owns both directions of the
// UtilityProcess control channel. Inert by construction if never
// instantiated -- main.ts only builds one when a transport is actually
// available (i.e. hosted by the Electron app), so the standalone `node`
// launch path is completely unaffected.
export class ControlChannel {
  private startedAt = Date.now();
  private denialsToday = 0;
  private snapshotTimer: ReturnType<typeof setInterval>;

  constructor(private deps: ControlChannelDeps) {
    this.deps.transport.onMessage((msg) => this.handleToCore(msg));
    this.snapshotTimer = setInterval(() => this.pushSnapshot(), deps.snapshotIntervalMs ?? 5000);
    this.pushSnapshot();
  }

  stop() {
    clearInterval(this.snapshotTimer);
  }

  pushSnapshot() {
    this.deps.transport.postMessage({ kind: 'snapshot', data: this.buildSnapshot() });
  }

  recordDenial() {
    this.denialsToday += 1;
    this.pushSnapshot();
  }

  forwardLog(source: string, level: LogLevel, message: string) {
    this.deps.transport.postMessage({ kind: 'log', entry: { ts: Date.now(), level, source, message } });
  }

  notifyWakeEnabledChanged(enabled: boolean, source: WakeChangeSource) {
    this.deps.transport.postMessage({ kind: 'wakeEnabledChanged', enabled, source });
  }

  notifyDisplayStartRequest(req: Omit<Extract<ToApp, { kind: 'displayStartRequest' }>, 'kind'>) {
    this.deps.transport.postMessage({ kind: 'displayStartRequest', ...req });
  }

  notifyDisplayStopRequest(req: { sessionId: string | null; reason: DisplayReason }) {
    this.deps.transport.postMessage({ kind: 'displayStopRequest', sessionId: req.sessionId, reason: req.reason });
  }

  private handleToCore(msg: ToCore) {
    if (msg.kind === 'getSnapshot') {
      this.pushSnapshot();
    } else if (msg.kind === 'reissueTunnel') {
      void this.deps.tunnelSupervisor.reissue();
    } else if (msg.kind === 'launchApp') {
      void this.deps.tunnelSupervisor.launchApp().then(() => this.pushSnapshot());
    } else if (msg.kind === 'setLaunchAppOnDock') {
      this.deps.tunnelSupervisor.setLaunchAppOnDock(msg.enabled);
      this.pushSnapshot();
    } else if (msg.kind === 'setAutomationEnabled') {
      this.deps.automationEngine.setEnabled(msg.enabled);
      this.pushSnapshot();
    } else if (msg.kind === 'setRuleEnabled') {
      this.deps.automationEngine.setRuleEnabled(msg.ruleId, msg.enabled);
      this.pushSnapshot();
    } else if (msg.kind === 'setScreensaverConfig') {
      this.deps.gateway.sendScreensaverConfig({ enabled: msg.enabled, graceMs: msg.graceMs });
    } else if (msg.kind === 'setCameraEnabled') {
      // Same as screensaver: no optimistic snapshot -- the Mac sees the new
      // value only once the phone applies it and reports presence.cameraConfig.
      this.deps.gateway.sendCameraEnabled(msg.enabled);
    } else if (msg.kind === 'setWakeEnabled') {
      this.deps.wakeSetting.set(msg.enabled, 'mac');
    } else if (msg.kind === 'displaySession') {
      const { kind: _kind, ...session } = msg;
      void this.deps.extendedDisplay?.onDisplaySession(session);
    } else if (msg.kind === 'displayToken') {
      void this.deps.extendedDisplay?.onDisplayToken({ sessionId: msg.sessionId, token: msg.token });
    }
  }

  private buildSnapshot(): StatusSnapshot {
    const plugins: StatusSnapshot['plugins'] = {};
    for (const [id, permissions] of Object.entries(this.deps.pluginPermissions)) {
      plugins[id] = { enabled: this.deps.enabledPlugins.includes(id), permissions };
    }
    return {
      core: { uptimeMs: Date.now() - this.startedAt, wsPort: this.deps.wsPort, watchdogTimeoutMs: this.deps.watchdogTimeoutMs },
      device: this.deps.tunnelSupervisor.getStatus(),
      clients: { connected: this.deps.gateway.getClientCount(), lastHelloAt: this.deps.gateway.getLastHelloAt() },
      presence: { state: this.deps.presenceEngine.getState(), since: this.deps.presenceEngine.getStateSince() },
      plugins,
      automation: { enabled: this.deps.automationEngine.isEnabled(), rules: this.deps.automationEngine.getRules() },
      denialsToday: this.denialsToday,
      screensaver: this.deps.phoneDisplay.getStatus(),
      camera: this.deps.camera.getStatus(),
    };
  }
}
