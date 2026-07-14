import { contextBridge, ipcRenderer } from 'electron';
import type { Config } from '@desk-agent/config-schema';
import type { StatusSnapshot, LogEntry, ToApp } from '@desk-agent/core';
import type { BinaryStatus } from '../shared/types.js';

const api = {
  ping: (): Promise<string> => ipcRenderer.invoke('ping'),
  getCoreHealth: (): Promise<string> => ipcRenderer.invoke('core:getHealth'),
  getConfig: (): Promise<Config> => ipcRenderer.invoke('config:get'),
  // Rejects with the Zod validation error if `config` doesn't satisfy
  // ConfigSchema -- the caller should treat a rejected setConfig as "nothing
  // was written," per configStore.ts's write-only-if-valid guarantee.
  setConfig: (config: Config): Promise<Config> => ipcRenderer.invoke('config:set', config),

  // Phase 3: the core's live ControlChannel state, forwarded through the
  // main process (apps/mac/src/main/index.ts's handleCoreMessage).
  getSnapshot: (): Promise<StatusSnapshot | null> => ipcRenderer.invoke('status:getSnapshot'),
  getLogs: (): Promise<LogEntry[]> => ipcRenderer.invoke('status:getLogs'),
  reissueTunnel: (): Promise<void> => ipcRenderer.invoke('status:reissueTunnel'),
  // Manual "Launch now" (Device pane) and the on-dock auto-launch toggle --
  // both live, session-scoped core state surfaced via the snapshot's
  // device.appLaunchStatus/launchAppOnDock fields, same pattern as
  // reissueTunnel/setAutomationEnabled (not a separate get/set-with-readback
  // pair like the OS-backed login/dockwatch toggles below, since this can't
  // be silently refused by the OS).
  launchApp: (): Promise<void> => ipcRenderer.invoke('status:launchApp'),
  setLaunchAppOnDock: (enabled: boolean): Promise<void> => ipcRenderer.invoke('status:setLaunchAppOnDock', enabled),
  setAutomationEnabled: (enabled: boolean): Promise<void> => ipcRenderer.invoke('status:setAutomationEnabled', enabled),
  setRuleEnabled: (ruleId: string, enabled: boolean): Promise<void> => ipcRenderer.invoke('status:setRuleEnabled', ruleId, enabled),
  getBinaryStatus: (): Promise<BinaryStatus> => ipcRenderer.invoke('binaries:getStatus'),
  getLaunchAtLogin: (): Promise<boolean> => ipcRenderer.invoke('login:getLaunchAtLogin'),
  // Resolves with the ACTUAL resulting OS state (main reads it back after
  // calling setLoginItemSettings), not just an assumed success -- the OS can
  // silently refuse the change, so callers should trust this return value
  // over the value they requested.
  setLaunchAtLogin: (enabled: boolean): Promise<boolean> => ipcRenderer.invoke('login:setLaunchAtLogin', enabled),
  getDockWatchEnabled: (): Promise<boolean> => ipcRenderer.invoke('dockwatch:getEnabled'),
  // Resolves with the ACTUAL resulting state (main re-reads isInstalled()
  // after writing/loading or removing/unloading the LaunchAgent), same
  // reasoning as setLaunchAtLogin -- launchctl can fail silently too.
  setDockWatchEnabled: (enabled: boolean): Promise<boolean> => ipcRenderer.invoke('dockwatch:setEnabled', enabled),
  // Live push (snapshot after every mutation, log lines as they happen).
  // Returns an unsubscribe function, matching the cleanup shape a React
  // useEffect expects.
  onStatusMessage: (cb: (msg: ToApp) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, msg: ToApp) => cb(msg);
    ipcRenderer.on('status:message', listener);
    return () => ipcRenderer.removeListener('status:message', listener);
  },
};

contextBridge.exposeInMainWorld('deskAgent', api);

export type DeskAgentApi = typeof api;
