import { Tray, Menu, nativeImage, type NativeImage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { StatusSnapshot } from '@desk-agent/core';
import type { CoreHealth } from './coreSupervisor.js';
import { coreHealthLabel, overallHealth, type HealthTone } from '../shared/health.js';
import type { ReleaseInfo } from './updateCheck.js';

// macOS template images (black + alpha, `Template` suffix): the OS tints
// them for light/dark/highlighted menu bars, like other monochrome glyphs.
const ICON_BY_HEALTH: Record<CoreHealth, string> = {
  running: 'trayTemplate.png',
  starting: 'trayTemplate.png',
  stopped: 'trayTemplate.png',
  crashed: 'trayCrashedTemplate.png',
};

// Health colour lives on the dropdown's status item instead (Docker-style).
// The colour comes from overallHealth() -- the same rule as the Overview
// headline -- so the tray and the settings window never disagree.
const DOT_BY_TONE: Record<HealthTone, string> = {
  green: 'tray-green.png',
  amber: 'tray-gray.png',
  red: 'tray-red.png',
};

// nativeImage.createFromPath() returns a silently-empty (invisible, not
// null/throwing) image for a nonexistent path -- a packaging regression
// that drops an icon file would otherwise leave the tray icon blank with no
// diagnostic, defeating refresh()'s whole point of keeping the icon and status
// dot an honest signal of core health. Log once per bad path so a packaging
// bug is at least discoverable.
const warnedMissingIcons = new Set<string>();

function loadIcon(file: string, resourcesPath: string): NativeImage {
  const iconPath = path.join(resourcesPath, file);
  if (!fs.existsSync(iconPath)) {
    if (!warnedMissingIcons.has(iconPath)) {
      warnedMissingIcons.add(iconPath);
      console.error(`[tray] icon file missing, icon will be blank: ${iconPath}`);
    }
    return nativeImage.createEmpty();
  }
  return nativeImage.createFromPath(iconPath);
}

function iconForHealth(health: CoreHealth, resourcesPath: string): NativeImage {
  const image = loadIcon(ICON_BY_HEALTH[health], resourcesPath);
  image.setTemplateImage(true);
  return image;
}

function dotForTone(tone: HealthTone, resourcesPath: string): NativeImage {
  return loadIcon(DOT_BY_TONE[tone], resourcesPath).resize({ width: 10, height: 10 });
}

export interface TrayControllerOptions {
  resourcesPath: string;
  getHealth: () => CoreHealth;
  /** Optional: richer live status (paired phone, tunnel, presence) for the dropdown, per the design mockup. Absent/null before the core's first snapshot arrives. */
  getSnapshot?: () => StatusSnapshot | null;
  onOpenSettings: () => void;
  /** Quick pause/resume from the tray dropdown, per the design mockup. Only offered once a snapshot exists (needs to know the current state to toggle it). */
  onToggleAutomation?: (enabled: boolean) => void;
  /** Non-intrusive update surfacing per the release-distribution spec: a menu item, never a dialog. */
  getUpdateAvailable?: () => ReleaseInfo | null;
  onOpenUpdate?: (url: string) => void;
  onQuit: () => void;
}

export class TrayController {
  private tray: Tray;

  constructor(private opts: TrayControllerOptions) {
    this.tray = new Tray(iconForHealth(opts.getHealth(), opts.resourcesPath));
    this.tray.setToolTip('Desk Agent');
    this.rebuildMenu();
  }

  /** Call after core health OR snapshot changes so the icon, status dot and menu content stay honest. */
  refresh() {
    this.tray.setImage(iconForHealth(this.opts.getHealth(), this.opts.resourcesPath));
    this.rebuildMenu();
  }

  destroy() {
    this.tray.destroy();
  }

  private rebuildMenu() {
    const health = this.opts.getHealth();
    const snapshot = this.opts.getSnapshot?.() ?? null;
    const items: Electron.MenuItemConstructorOptions[] = [
      {
        // Same label as the settings sidebar footer (shared/health.ts).
        label: coreHealthLabel(health),
        // Green only when the core is running AND a snapshot shows the phone
        // app connected (see overallHealth) -- a running core with no phone
        // app connected (e.g. stuck on an RN error screen), or no snapshot
        // yet, isn't healthy from the user's point of view.
        icon: dotForTone(overallHealth(health, snapshot).tone, this.opts.resourcesPath),
        enabled: false,
      },
    ];
    const update = this.opts.getUpdateAvailable?.() ?? null;
    if (update) {
      items.push({
        label: `Update available: v${update.version}…`,
        click: () => this.opts.onOpenUpdate?.(update.url),
      });
    }
    if (snapshot) {
      items.push(
        { type: 'separator' },
        { label: `Paired phone: ${pairedPhoneName(snapshot.device)}`, enabled: false },
        {
          // clients.connected counts every WS client on 127.0.0.1:8787; today
          // only the phone app connects there.
          label: snapshot.clients.connected > 0 ? 'Phone app: connected' : 'Phone app: not connected',
          enabled: false,
        },
        { label: `adb tunnel: ${snapshot.device.tunnelStatus}`, enabled: false },
        { label: `Presence: ${snapshot.presence.state}`, enabled: false },
      );
      if (this.opts.onToggleAutomation) {
        const enabled = snapshot.automation.enabled;
        // An action, not status: separate it from the read-only status block.
        items.push({ type: 'separator' }, {
          label: enabled ? 'Pause automation' : 'Resume automation',
          click: () => this.opts.onToggleAutomation?.(!enabled),
        });
      }
    }
    items.push(
      { type: 'separator' },
      // macOS convention: "Settings…" with ⌘, (shown in the menu; only live while it's open).
      { label: 'Settings…', accelerator: 'Command+,', click: () => this.opts.onOpenSettings() },
      { label: 'Quit Desk Agent', click: () => this.opts.onQuit() },
    );
    this.tray.setContextMenu(Menu.buildFromTemplate(items));
  }
}

/** Tray "Paired phone" value: the model name core resolved (e.g. "OnePlus 6T"), else the adb serial, else "none". */
export function pairedPhoneName(device: Pick<StatusSnapshot['device'], 'serial' | 'model'>): string {
  const model = device.model?.trim();
  return model || device.serial || 'none';
}
