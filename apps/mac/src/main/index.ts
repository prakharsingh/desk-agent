import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StatusSnapshot, ToApp, ToCore, LogEntry } from '@desk-agent/core';
import { CoreSupervisor } from './coreSupervisor.js';
import { TrayController } from './tray.js';
import { ensureConfigExists, defaultConfigPath } from './firstRunConfig.js';
import { readConfig, writeConfig } from './configStore.js';
import { debounce } from './debounce.js';
import { LogBuffer } from './logBuffer.js';
import { augmentedPath, checkBinaries } from './binaries.js';
import * as dockWatch from './dockWatch.js';
import { startUpdateChecker } from './updateCheck.js';
import { TRAFFIC_LIGHT_POSITION } from '../shared/constants.js';

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
  let latestSnapshot: StatusSnapshot | null = null;
  const configPath = defaultConfigPath();
  const logBuffer = new LogBuffer(500);

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
    if (msg.kind === 'snapshot') {
      latestSnapshot = msg.data;
      tray?.refresh();
    } else if (msg.kind === 'log') {
      logBuffer.push(msg.entry);
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
      title: 'Desk Agent',
      // Matches the design mockup's chrome-less sidebar: the renderer draws
      // its own branding/nav where a title bar would be, with only the
      // native traffic lights inset over it (not a custom-drawn title bar
      // and not fake traffic-light dots -- those are real, OS-drawn ones).
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: TRAFFIC_LIGHT_POSITION,
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

    // electron-vite sets ELECTRON_RENDERER_URL in `dev` mode (renderer served
    // by its own Vite dev server); a built/packaged app loads the static
    // out/renderer/index.html instead.
    if (process.env.ELECTRON_RENDERER_URL) {
      void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    } else {
      void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    }
  }

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
    // running core are simply left as they were.
    const written = writeConfig(configPath, config);
    scheduleCoreRestart();
    return written;
  });
  ipcMain.handle('status:getSnapshot', () => latestSnapshot);
  ipcMain.handle('status:getLogs', () => logBuffer.getAll());
  ipcMain.handle('status:reissueTunnel', () => sendToCore({ kind: 'reissueTunnel' }));
  ipcMain.handle('status:launchApp', () => sendToCore({ kind: 'launchApp' }));
  ipcMain.handle('status:setLaunchAppOnDock', (_event, enabled: boolean) => sendToCore({ kind: 'setLaunchAppOnDock', enabled }));
  ipcMain.handle('status:setAutomationEnabled', (_event, enabled: boolean) => sendToCore({ kind: 'setAutomationEnabled', enabled }));
  ipcMain.handle('status:setRuleEnabled', (_event, ruleId: string, enabled: boolean) => sendToCore({ kind: 'setRuleEnabled', ruleId, enabled }));
  // A main-process-only concern (see binaries.ts): whether adb/nowplaying-cli
  // are resolvable, not part of the core's ControlChannel StatusSnapshot.
  // Computed once (which binaries are installed essentially never changes
  // mid-session) and cached here, mirroring latestSnapshot's cache-and-serve
  // pattern, instead of re-doing sync fs.existsSync calls on every mount.
  let binaryStatus = checkBinaries();
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
  ipcMain.handle('dockwatch:setEnabled', (_event, enabled: boolean) => (enabled ? dockWatch.install() : dockWatch.uninstall()));
  ipcMain.handle('status:setScreensaverConfig', (_event, enabled: boolean, graceMs: number) =>
    sendToCore({ kind: 'setScreensaverConfig', enabled, graceMs }));

  function sendToCore(msg: ToCore) {
    supervisor?.sendToCore(msg);
  }

  app.whenReady().then(() => {
    ensureConfigExists(configPath);

    supervisor = new CoreSupervisor({
      coreHostPath: path.join(__dirname, 'coreHost.js'),
      configPath,
      // A GUI launch gets a minimal PATH (missing Homebrew/Android-SDK dirs)
      // -- see binaries.ts -- so the core's adb/nowplaying-cli execFile
      // calls would ENOENT without this. A function, recomputed on every
      // spawn/restart, so a binary installed after the app launched is
      // picked up by the next restart rather than requiring a full quit.
      extraEnv: () => ({ PATH: augmentedPath(process.env.PATH ?? '') }),
      onStderr: recordStderr,
      onHealthChange: () => tray?.refresh(),
      onMessage: (msg) => handleCoreMessage(msg as ToApp),
    });

    tray = new TrayController({
      resourcesPath: resourcesPath(),
      getHealth: () => supervisor?.getHealth() ?? 'stopped',
      getSnapshot: () => latestSnapshot,
      onOpenSettings: () => showSettingsWindow(),
      onToggleAutomation: (enabled) => sendToCore({ kind: 'setAutomationEnabled', enabled }),
      getUpdateAvailable: () => updateChecker.getAvailable(),
      onOpenUpdate: (url) => { void shell.openExternal(url); },
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
    supervisor?.stop();
    tray?.destroy();
    updateChecker.stop();
  });
}
