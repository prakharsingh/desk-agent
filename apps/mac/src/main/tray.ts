import { Tray, Menu, nativeImage, type NativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { StatusSnapshot } from '@desk-agent/core';
import type { CoreHealth } from './coreSupervisor.js';

const ICON_BY_HEALTH: Record<CoreHealth, string> = {
  running: 'tray-green.png',
  starting: 'tray-gray.png',
  stopped: 'tray-gray.png',
  crashed: 'tray-red.png',
};

const LABEL_BY_HEALTH: Record<CoreHealth, string> = {
  running: 'Core running',
  starting: 'Core starting…',
  stopped: 'Core stopped',
  crashed: 'Core crashed',
};

// nativeImage.createFromPath() returns a silently-empty (invisible, not
// null/throwing) image for a nonexistent path -- a packaging regression
// that drops an icon file would otherwise leave the tray icon blank with no
// diagnostic, defeating refresh()'s whole point of keeping the icon color
// an honest signal of core health. Log once per bad path so a packaging
// bug is at least discoverable.
const warnedMissingIcons = new Set<string>();

function iconForHealth(health: CoreHealth, resourcesPath: string): NativeImage {
  const iconPath = path.join(resourcesPath, ICON_BY_HEALTH[health]);
  if (!fs.existsSync(iconPath)) {
    if (!warnedMissingIcons.has(iconPath)) {
      warnedMissingIcons.add(iconPath);
      console.error(`[tray] icon file missing, tray icon will be blank: ${iconPath}`);
    }
    return nativeImage.createEmpty();
  }
  return nativeImage.createFromPath(iconPath);
}

export interface TrayControllerOptions {
  resourcesPath: string;
  getHealth: () => CoreHealth;
  /** Optional: richer live status (paired phone, tunnel, presence) for the dropdown, per the design mockup. Absent/null before the core's first snapshot arrives. */
  getSnapshot?: () => StatusSnapshot | null;
  onOpenSettings: () => void;
  /** Quick pause/resume from the tray dropdown, per the design mockup. Only offered once a snapshot exists (needs to know the current state to toggle it). */
  onToggleAutomation?: (enabled: boolean) => void;
  onQuit: () => void;
}

export class TrayController {
  private tray: Tray;

  constructor(private opts: TrayControllerOptions) {
    this.tray = new Tray(iconForHealth(opts.getHealth(), opts.resourcesPath));
    this.tray.setToolTip('Desk Agent');
    this.rebuildMenu();
  }

  /** Call after core health OR snapshot changes so the icon color and menu content stay honest. */
  refresh() {
    this.tray.setImage(iconForHealth(this.opts.getHealth(), this.opts.resourcesPath));
    this.rebuildMenu();
  }

  destroy() {
    this.tray.destroy();
  }

  private rebuildMenu() {
    const snapshot = this.opts.getSnapshot?.() ?? null;
    const items: Electron.MenuItemConstructorOptions[] = [
      { label: LABEL_BY_HEALTH[this.opts.getHealth()], enabled: false },
    ];
    if (snapshot) {
      items.push(
        { type: 'separator' },
        { label: `Paired phone: ${snapshot.device.serial ?? 'none'}`, enabled: false },
        { label: `adb tunnel: ${snapshot.device.tunnelStatus}`, enabled: false },
        { label: `Presence: ${snapshot.presence.state}`, enabled: false },
      );
      if (this.opts.onToggleAutomation) {
        const enabled = snapshot.automation.enabled;
        items.push({
          label: enabled ? 'Pause automation' : 'Resume automation',
          click: () => this.opts.onToggleAutomation?.(!enabled),
        });
      }
    }
    items.push(
      { type: 'separator' },
      { label: 'Open Desk Agent Settings…', click: () => this.opts.onOpenSettings() },
      { label: 'Quit Desk Agent', click: () => this.opts.onQuit() },
    );
    this.tray.setContextMenu(Menu.buildFromTemplate(items));
  }
}
