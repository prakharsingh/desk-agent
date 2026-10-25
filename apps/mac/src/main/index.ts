import { app, BrowserWindow, ipcMain, nativeTheme, Notification, shell, systemPreferences } from 'electron';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ToApp, ToCore, LogEntry } from '@desk-agent/core';
import type { StatusMessage } from '../shared/types.js';
import { CoreSupervisor } from './coreSupervisor.js';
import { TrayController } from './tray.js';
import { ensureConfigExists, reconcileWidgetsOnDisk, defaultConfigPath } from './firstRunConfig.js';
import { readConfig } from './configStore.js';
import { ConfigSchema } from '@desk-agent/config-schema';
import { DisplayHelperHost } from './displayHelperHost.js';
import { packagedDisplayHelperPath } from './displayHelperPath.js';
import { DisplaySessionManager } from './displaySessionManager.js';
import { DisplayIdentityStore } from './displayIdentityStore.js';
import { AccessibilityNotice, showTouchNotification, type TouchNotice } from './accessibilityNotice.js';
import { debounce } from './debounce.js';
import { LogBuffer } from './logBuffer.js';
import { describePermissionStatus } from './permissionProbe.js';
import { SnapshotCache } from './snapshotCache.js';
import { WakeSync } from './wakeSync.js';
import { augmentedPath, checkBinaries, resolveAdb } from './binaries.js';
import * as dockWatch from './dockWatch.js';
import { startUpdateChecker } from './updateCheck.js';
import { TRAFFIC_LIGHT_POSITION, USE_SIDEBAR_VIBRANCY, windowBackgroundColor } from '../shared/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// A second launch must not spawn a second core -- it would collide on
// wsGateway's 127.0.0.1:8787 bind (EADDRINUSE). Bail out before touching
// anything else; the running instance's 'second-instance' handler takes over.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let mainWindow: BrowserWindow | null = null;
  let tray: TrayController | null = null;
  let supervisor: CoreSupervisor | null = null;
  // Phone extended display: main owns the helper session (created at whenReady).
  let sessionMgr: DisplaySessionManager | null = null;
  const snapshotCache = new SnapshotCache();
  const configPath = defaultConfigPath();
  const logBuffer = new LogBuffer(500);
  // Monitor wake on return: persisted to config.json but applied LIVE by the
  // core -- never routed through config:set's scheduleCoreRestart.
  const wakeSync = new WakeSync({
    configPath,
    sendToCore: (msg) => sendToCore(msg),
    notifyRenderer: (config) => mainWindow?.webContents.send('status:message', { kind: 'configChanged', config } satisfies StatusMessage),
  });

  const updateChecker = startUpdateChecker({
    currentVersion: app.getVersion(),
    onUpdateAvailable: () => tray?.refresh(),
  });

  // The core only reads config at boot (no live hot-reload), so "apply the
  // new config" means restarting it. Debounced so rapid successive edits
  // (e.g. repeated stepper clicks) coalesce into one restart instead of
  // restarting -- and briefly dropping the phone's WS connection -- per click.
  const scheduleCoreRestart = debounce(() => supervisor?.restart(), 800);

  // The core's ControlChannel pushes ToApp messages (snapshot/log) over
  // CoreSupervisor's message channel; cache the latest here so a renderer
  // that mounts (or remounts, e.g. closing and reopening the settings
  // window) between pushes still has real data immediately, via
  // status:getSnapshot/status:getLogs, rather than waiting up to
  // snapshotIntervalMs for the next periodic push.
  function handleCoreMessage(msg: ToApp) {
    // Display session requests are main's business only; never forwarded to the renderer.
    if (msg.kind === 'displayStartRequest') {
      sessionMgr?.handleStartRequest(msg);
      return;
    }
    if (msg.kind === 'displayStopRequest') {
      sessionMgr?.handleStopRequest({ sessionId: msg.sessionId, reason: msg.reason });
      return;
    }
    if (msg.kind === 'snapshot') {
      snapshotCache.set(msg.data);
      // Core-restart resync: the first snapshot after 'running' proves core's control channel is listening.
      sessionMgr?.onCoreSnapshot();
      tray?.refresh();
    } else if (msg.kind === 'log') {
      logBuffer.push(msg.entry);
    } else if (msg.kind === 'wakeEnabledChanged') {
      try {
        wakeSync.handleCoreMessage(msg);
      } catch (err) {
        recordStderr(`failed to persist ${msg.source}-sourced wakeEnabled change: ${String(err)}`);
      }
    }
    mainWindow?.webContents.send('status:message', msg);
  }

  // For raw stderr text from the forked core process (see coreSupervisor's
  // onStderr) -- distinct from handleCoreMessage's structured ControlChannel
  // 'log' messages, which only exist once the core is far enough along to
  // construct its ControlChannel. Wrapping stderr into the same LogEntry
  // shape and pushing it through logBuffer/status:message means a boot-time
  // crash (e.g. a missing module inside the packaged asar) reaches the Logs
  // pane instead of only console.error, which a packaged, GUI-launched app's
  // user has no way to see.
  function recordStderr(text: string) {
    const entry: LogEntry = { ts: Date.now(), level: 'error', source: 'core-process', message: text };
    logBuffer.push(entry);
    mainWindow?.webContents.send('status:message', { kind: 'log', entry } satisfies ToApp);
  }

  // Display-helper diagnostics (events, stderr, session lifecycle) go to the Logs pane as source 'display'.
  // The session token is never part of any message logged here.
  function recordDisplayLog(level: LogEntry['level'], message: string) {
    const entry: LogEntry = { ts: Date.now(), level, source: 'display', message };
    logBuffer.push(entry);
    mainWindow?.webContents.send('status:message', { kind: 'log', entry } satisfies ToApp);
  }

  // Packaged: Contents/Helpers, never Contents/MacOS (see displayHelperPath.ts); dev: apps/mac/native-bin.
  function displayHelperPath(): string {
    return app.isPackaged
      ? packagedDisplayHelperPath(process.execPath)
      : path.join(__dirname, '../../native-bin/desk-agent-display-helper');
  }

  function displayIds(): { vendorId: number; productId: number } {
    try {
      return readConfig(configPath).display;
    } catch (err) {
      recordDisplayLog('warn', `config unreadable, using default display ids: ${String(err)}`);
      return ConfigSchema.shape.display.parse(undefined);
    }
  }

  // The adb we ship, used only when the user has none of their own (see
  // resolveAdb). Packaged: next to the executable; dev: apps/mac/native-bin.
  function bundledAdbPath(): string {
    return app.isPackaged ? path.join(path.dirname(process.execPath), 'adb') : path.join(__dirname, '../../native-bin/adb');
  }

  function resourcesPath(): string {
    return app.isPackaged ? path.join(process.resourcesPath, 'resources') : path.join(__dirname, '../../resources');
  }

  function showSettingsWindow() {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      return;
    }
    mainWindow = new BrowserWindow({
      width: 1140,
      height: 748,
      minWidth: 820,
      minHeight: 560,
      title: 'Desk Agent',
      // Matches the design mockup's chrome-less sidebar: the renderer draws
      // its own branding/nav where a title bar would be, with only the
      // native traffic lights inset over it (not a custom-drawn title bar
      // and not fake traffic-light dots -- those are real, OS-drawn ones).
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: TRAFFIC_LIGHT_POSITION,
      // Translucent Finder/System-Settings-style sidebar. The material
      // follows the window's key state and the system appearance.
      ...(USE_SIDEBAR_VIBRANCY ? { vibrancy: 'sidebar' as const, visualEffectState: 'followWindow' as const } : {}),
      // Electron's default native surface is white; it shows for the frames
      // before the renderer's first paint (open) and after its teardown
      // (close), flashing white against the UI. With vibrancy the surface
      // is transparent so those frames show the (appearance-matched)
      // sidebar material instead of white; without it, it's the current
      // appearance's --content color. Either way the window isn't shown
      // until the renderer has produced its first frame.
      backgroundColor: windowBackgroundColor(nativeTheme.shouldUseDarkColors),
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
    mainWindow.once('ready-to-show', () => {
      mainWindow?.show();
    });

    // electron-vite sets ELECTRON_RENDERER_URL in `dev` mode (renderer served
    // by its own Vite dev server); a built/packaged app loads the static
    // out/renderer/index.html instead.
    if (process.env.ELECTRON_RENDERER_URL) {
      void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    } else {
      void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    }
  }

  // The renderer follows prefers-color-scheme; keep the native surface in
  // step when the macOS appearance changes (a no-op with vibrancy on, where
  // it stays transparent).
  nativeTheme.on('updated', () => {
    mainWindow?.setBackgroundColor(windowBackgroundColor(nativeTheme.shouldUseDarkColors));
  });

  app.on('second-instance', () => {
    showSettingsWindow();
  });

  ipcMain.handle('ping', () => 'pong');
  ipcMain.handle('core:getHealth', () => supervisor?.getHealth() ?? 'stopped');
  ipcMain.handle('config:get', () => readConfig(configPath));
  ipcMain.handle('config:set', (_event, config: unknown) => {
    // Throws (rejecting the renderer's ipcRenderer.invoke promise) if
    // `config` fails ConfigSchema validation -- writeConfig guarantees it
    // never touches disk in that case, so the on-disk config and the
    // running core are simply left as they were. presence.wakeEnabled is
    // kept at its on-disk value (owned by the live WakeSync path), so a stale
    // full-config save can't undo a phone-side wake toggle.
    const written = wakeSync.writeRendererConfig(config);
    scheduleCoreRestart();
    return written;
  });
  ipcMain.handle('status:getSnapshot', () => snapshotCache.get());
  ipcMain.handle('status:getLogs', () => logBuffer.getAll());
  ipcMain.handle('status:reissueTunnel', () => sendToCore({ kind: 'reissueTunnel' }));
  ipcMain.handle('status:launchApp', () => sendToCore({ kind: 'launchApp' }));
  ipcMain.handle('status:setLaunchAppOnDock', (_event, enabled: boolean) => sendToCore({ kind: 'setLaunchAppOnDock', enabled }));
  ipcMain.handle('status:setAutomationEnabled', (_event, enabled: boolean) => sendToCore({ kind: 'setAutomationEnabled', enabled }));
  ipcMain.handle('status:setRuleEnabled', (_event, ruleId: string, enabled: boolean) => sendToCore({ kind: 'setRuleEnabled', ruleId, enabled }));
  // A main-process-only concern (see binaries.ts): whether adb/nowplaying-cli
  // are resolvable, not part of the core's ControlChannel StatusSnapshot.
  // Computed once (which binaries are installed essentially never changes
  // mid-session) and cached here, mirroring snapshotCache's cache-and-serve
  // pattern, instead of re-doing sync fs.existsSync calls on every mount.
  const adb = resolveAdb({ bundledPath: bundledAdbPath() });
  const binaryStatus = checkBinaries(undefined, adb);
  ipcMain.handle('binaries:getStatus', () => binaryStatus);
  // OS login-item state is the source of truth -- deliberately not mirrored
  // into config.json, so it can never drift from what macOS actually has
  // set. setLoginItemSettings can throw or be silently refused by the OS
  // (e.g. app not in /Applications); reading it back and returning the
  // actual resulting value (rather than assuming success) lets the renderer
  // reconcile instead of trusting an optimistic update that may not hold.
  ipcMain.handle('login:getLaunchAtLogin', () => app.getLoginItemSettings().openAtLogin);
  ipcMain.handle('login:setLaunchAtLogin', (_event, enabled: boolean) => {
    app.setLoginItemSettings({ openAtLogin: enabled });
    return app.getLoginItemSettings().openAtLogin;
  });
  // "Launch Desk Agent when phone is docked" -- a launchd LaunchAgent, not a
  // login item, since the trigger is a later USB dock event while already
  // logged in, not OS login (see dockWatch.ts). Same read-the-actual-state-
  // back pattern as the login toggle above: launchctl can fail silently, so
  // the renderer trusts isInstalled()'s answer, not an assumed success.
  ipcMain.handle('dockwatch:getEnabled', () => dockWatch.isInstalled());
  ipcMain.handle('dockwatch:setEnabled', (_event, enabled: boolean) => (enabled ? dockWatch.install({ adbPath: adb?.path }) : dockWatch.uninstall()));
  ipcMain.handle('status:setScreensaverConfig', (_event, enabled: boolean, graceMs: number) =>
    sendToCore({ kind: 'setScreensaverConfig', enabled, graceMs }));
  // Phone-owned camera presence: a request to the phone, confirmed back via snapshot.camera.
  ipcMain.handle('status:setCameraEnabled', (_event, enabled: boolean) => sendToCore({ kind: 'setCameraEnabled', enabled }));
  // Mac-owned wake: persist + live core update, NO core restart (see wakeSync.ts).
  ipcMain.handle('config:setWakeEnabled', (_event, enabled: boolean) => wakeSync.setFromMac(Boolean(enabled)));

  function sendToCore(msg: ToCore) {
    supervisor?.sendToCore(msg);
  }

  app.whenReady().then(() => {
    // Follow System Settings > Appearance (no in-app override).
    nativeTheme.themeSource = 'system';
    // One line per launch for the TCC persistence test; both calls are read-only and never prompt.
    // A diagnostic must not be able to keep the app from starting.
    try {
      logBuffer.push({
        ts: Date.now(),
        level: 'info',
        source: 'permissions',
        message: describePermissionStatus(
          systemPreferences.getMediaAccessStatus('screen'),
          systemPreferences.isTrustedAccessibilityClient(false),
          app.getVersion(),
        ),
      });
    } catch (err) {
      recordStderr(`permission probe failed: ${String(err)}`);
    }
    ensureConfigExists(configPath);
    // Switch newly added widget tiles on once for existing installs, before
    // core or the Widgets pane read the file. Best effort: a failure here must
    // not keep the app (and core) from starting.
    try {
      reconcileWidgetsOnDisk(configPath);
    } catch (err) {
      recordStderr(`widget reconcile failed: ${String(err)}`);
    }

    const helperPath = displayHelperPath();
    const pidfilePath = path.join(app.getPath('userData'), 'display-helper.pid');
    const devTokenEnv = process.env.DESK_AGENT_DISPLAY_DEV_TOKEN_FILE;
    // Touch needs Accessibility: once per launch, ask through the helper (its own TCC request, so Desk Agent is the
    // app macOS lists); our notice follows 3 s later only if the permission is still missing (accessibilityNotice.ts).
    const accessibilityNotice = new AccessibilityNotice({
      requestPermissions: () => {
        execFile(helperPath, ['--request-permissions'], { timeout: 15000 }, (err, stdout) => {
          if (err) recordDisplayLog('warn', `helper --request-permissions failed: ${err.message}`);
          else recordDisplayLog('info', `helper --request-permissions: ${stdout.trim()}`);
        });
      },
      checkPostEvent: (done) => {
        execFile(helperPath, ['--check'], { timeout: 5000 }, (err, stdout) => {
          if (err) {
            recordDisplayLog('warn', `helper --check failed: ${err.message}`);
            return done(null);
          }
          try {
            const r = JSON.parse(stdout.trim()) as { postEvent?: unknown };
            done(typeof r.postEvent === 'boolean' ? r.postEvent : null);
          } catch {
            done(null);
          }
        });
      },
      notify: (n: TouchNotice) =>
        showTouchNotification(n, {
          isSupported: () => Notification.isSupported(),
          create: (opts) => new Notification(opts),
          onLog: recordDisplayLog,
        }),
      openSettings: (url) => { void shell.openExternal(url); },
      onLog: recordDisplayLog,
    });
    sessionMgr = new DisplaySessionManager({
      createHost: (handlers) => new DisplayHelperHost({
        helperPath,
        pidfilePath,
        onEvent: handlers.onEvent,
        onExit: handlers.onExit,
        onSpawn: handlers.onSpawn,
        onStderr: (text) => {
          const trimmed = text.trimEnd();
          if (trimmed) recordDisplayLog('info', `helper: ${trimmed}`);
        },
      }),
      sendToCore: (msg) => sendToCore(msg),
      getIds: displayIds,
      isSupportedMacOS: () => Number(os.release().split('.')[0]) >= 23,
      onChange: () => tray?.refresh(),
      onLog: recordDisplayLog,
      // Dev tooling only (test-client.mjs reads it); never in a packaged app.
      devTokenFile: !app.isPackaged && devTokenEnv ? devTokenEnv : null,
      // Per-phone display-identity generation (Ruling P0-7), next to config.json.
      identityStore: new DisplayIdentityStore(path.join(path.dirname(configPath), 'display-identity.json')),
      onPostEventMissing: () => accessibilityNotice.onPostEventMissing(),
    });
    // A helper left over from a crashed previous run would hold the virtual display and port 8788.
    new DisplayHelperHost({ helperPath, pidfilePath, onEvent: () => {}, onExit: () => {} }).killStale();

    supervisor = new CoreSupervisor({
      coreHostPath: path.join(__dirname, 'coreHost.js'),
      configPath,
      // A GUI launch gets a minimal PATH (missing Homebrew/Android-SDK dirs)
      // -- see binaries.ts -- so the core's adb/nowplaying-cli execFile
      // calls would ENOENT without this. A function, recomputed on every
      // spawn/restart, so a binary installed after the app launched is
      // picked up by the next restart rather than requiring a full quit.
      extraEnv: () => ({ PATH: augmentedPath(process.env.PATH ?? ''), ...(adb ? { DESK_AGENT_ADB: adb.path } : {}) }),
      onStderr: recordStderr,
      onHealthChange: (health) => {
        // Drop the snapshot once the core leaves 'running' so neither the tray
        // nor the renderer keeps presenting a dead core's last state as live.
        if (snapshotCache.onHealthChange(health)) {
          mainWindow?.webContents.send('status:message', { kind: 'snapshotCleared' } satisfies StatusMessage);
        }
        // Arm the display-session resync; it fires on the next snapshot (see onCoreSnapshot).
        if (health === 'running') sessionMgr?.onCoreRunning();
        tray?.refresh();
      },
      onMessage: (msg) => handleCoreMessage(msg as ToApp),
    });

    tray = new TrayController({
      resourcesPath: resourcesPath(),
      getHealth: () => supervisor?.getHealth() ?? 'stopped',
      getSnapshot: () => snapshotCache.get(),
      onOpenSettings: () => showSettingsWindow(),
      onToggleAutomation: (enabled) => sendToCore({ kind: 'setAutomationEnabled', enabled }),
      getUpdateAvailable: () => updateChecker.getAvailable(),
      onOpenUpdate: (url) => { void shell.openExternal(url); },
      getDisplayActive: () => sessionMgr?.isActive() ?? false,
      onDisconnectDisplay: () => sessionMgr?.disconnectFromMenu(),
      onQuit: () => app.quit(),
    });

    supervisor.start();
    showSettingsWindow();
  });

  app.on('window-all-closed', () => {
    // Menu-bar-resident app: the tray icon (and the core it supervises) stay
    // alive when the settings window closes. Only Quit exits.
  });

  app.on('activate', () => {
    showSettingsWindow();
  });

  app.on('before-quit', () => {
    sessionMgr?.shutdown();
    supervisor?.stop();
    tray?.destroy();
    tray = null;
    updateChecker.stop();
  });
}
