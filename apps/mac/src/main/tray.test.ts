import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import type { CoreHealth } from './coreSupervisor.js';
import type { StatusSnapshot } from '@desk-agent/core';

interface FakeImage {
  path: string | null;
  setTemplateImage: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
}

const trays: Array<{ image: FakeImage; menu: Electron.MenuItemConstructorOptions[] }> = [];

vi.mock('electron', () => {
  const makeImage = (p: string | null): FakeImage => {
    const image: FakeImage = {
      path: p,
      setTemplateImage: vi.fn(),
      resize: vi.fn(() => image),
    };
    return image;
  };
  class Tray {
    image: FakeImage;
    menu: Electron.MenuItemConstructorOptions[] = [];
    constructor(image: FakeImage) {
      this.image = image;
      trays.push(this);
    }
    destroyed = false;
    setToolTip() {}
    setImage(image: FakeImage) {
      if (this.destroyed) throw new Error('Tray is destroyed');
      this.image = image;
    }
    setContextMenu(menu: Electron.MenuItemConstructorOptions[]) {
      if (this.destroyed) throw new Error('Tray is destroyed');
      this.menu = menu;
    }
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  return {
    Tray,
    Menu: { buildFromTemplate: (items: unknown) => items },
    nativeImage: { createFromPath: makeImage, createEmpty: () => makeImage(null) },
  };
});

const { TrayController, pairedPhoneName } = await import('./tray.js');

const resourcesPath = path.resolve(__dirname, '../../resources');

function makeTray(health: CoreHealth) {
  new TrayController({
    resourcesPath,
    getHealth: () => health,
    onOpenSettings: () => {},
    onQuit: () => {},
  });
  return trays[trays.length - 1];
}

describe('TrayController', () => {
  beforeEach(() => {
    trays.length = 0;
  });

  it.each([
    // No snapshot yet: the core is up but nothing proves the phone app is
    // connected, so the dot must not be green.
    ['running', 'trayTemplate.png', 'tray-gray.png', 'Core running'],
    ['starting', 'trayTemplate.png', 'tray-gray.png', 'Core starting…'],
    ['stopped', 'trayTemplate.png', 'tray-gray.png', 'Core stopped'],
    ['crashed', 'trayCrashedTemplate.png', 'tray-red.png', 'Core crashed'],
  ] as const)('%s: phone template icon, colour dot on the status item', (health, icon, dot, label) => {
    const tray = makeTray(health);

    expect(tray.image.path).toBe(path.join(resourcesPath, icon));
    expect(tray.image.setTemplateImage).toHaveBeenCalledWith(true);

    const first = tray.menu[0];
    expect(first.label).toBe(label);
    expect(first.enabled).toBe(false);
    const dotImage = first.icon as unknown as FakeImage;
    expect(dotImage.path).toBe(path.join(resourcesPath, dot));
    expect(dotImage.setTemplateImage).not.toHaveBeenCalled();
    expect(dotImage.resize).toHaveBeenCalledWith({ width: 10, height: 10 });
  });

  it('refresh() swaps to the crashed template when health changes', () => {
    let health: CoreHealth = 'running';
    const controller = new TrayController({
      resourcesPath,
      getHealth: () => health,
      onOpenSettings: () => {},
      onQuit: () => {},
    });
    const tray = trays[trays.length - 1];
    health = 'crashed';
    controller.refresh();

    expect(tray.image.path).toBe(path.join(resourcesPath, 'trayCrashedTemplate.png'));
    expect(tray.image.setTemplateImage).toHaveBeenCalledWith(true);
    expect((tray.menu[0].icon as unknown as FakeImage).path).toBe(path.join(resourcesPath, 'tray-red.png'));
  });

  it.each([
    [0, 'tray-gray.png', 'Phone app: not connected'],
    [1, 'tray-green.png', 'Phone app: connected'],
  ] as const)('running with %i phone clients: dot is %s and the menu says "%s"', (connected, dot, phoneLabel) => {
    const snapshot = {
      device: { serial: 'abc123', tunnelStatus: 'reissued' },
      clients: { connected, lastHelloAt: null },
      presence: { state: 'present' },
      automation: { enabled: true },
    } as unknown as StatusSnapshot;
    new TrayController({
      resourcesPath,
      getHealth: () => 'running',
      getSnapshot: () => snapshot,
      onOpenSettings: () => {},
      onQuit: () => {},
    });
    const tray = trays[trays.length - 1];

    expect((tray.menu[0].icon as unknown as FakeImage).path).toBe(path.join(resourcesPath, dot));
    expect(tray.menu.map((i) => i.label)).toContain(phoneLabel);
  });

  it('running with a connected phone but a failed adb tunnel: dot is red', () => {
    const snapshot = {
      device: { serial: 'abc123', tunnelStatus: 'failed' },
      clients: { connected: 1, lastHelloAt: null },
      presence: { state: 'present' },
      automation: { enabled: true },
    } as unknown as StatusSnapshot;
    new TrayController({
      resourcesPath,
      getHealth: () => 'running',
      getSnapshot: () => snapshot,
      onOpenSettings: () => {},
      onQuit: () => {},
    });
    const tray = trays[trays.length - 1];

    expect((tray.menu[0].icon as unknown as FakeImage).path).toBe(path.join(resourcesPath, 'tray-red.png'));
  });

  it.each([
    ['crashed', 'tray-red.png'],
    ['starting', 'tray-gray.png'],
    ['stopped', 'tray-gray.png'],
  ] as const)('%s with a stale snapshot still showing the phone connected: dot is %s, not green', (health, dot) => {
    const snapshot = {
      device: { serial: 'abc123', tunnelStatus: 'reissued' },
      clients: { connected: 1, lastHelloAt: null },
      presence: { state: 'present' },
      automation: { enabled: true },
    } as unknown as StatusSnapshot;
    new TrayController({
      resourcesPath,
      getHealth: () => health,
      getSnapshot: () => snapshot,
      onOpenSettings: () => {},
      onQuit: () => {},
    });
    const tray = trays[trays.length - 1];

    expect((tray.menu[0].icon as unknown as FakeImage).path).toBe(path.join(resourcesPath, dot));
  });
});

describe('TrayController menu layout', () => {
  beforeEach(() => {
    trays.length = 0;
  });

  const snapshot = {
    device: { serial: 'abc123', tunnelStatus: 'reissued' },
    clients: { connected: 1, lastHelloAt: null },
    presence: { state: 'present' },
    automation: { enabled: true },
  } as unknown as StatusSnapshot;

  it('separates "Pause automation" from the read-only status block', () => {
    new TrayController({
      resourcesPath,
      getHealth: () => 'running',
      getSnapshot: () => snapshot,
      onOpenSettings: () => {},
      onToggleAutomation: () => {},
      onQuit: () => {},
    });
    const menu = trays[trays.length - 1].menu;
    const pauseIndex = menu.findIndex((i) => i.label === 'Pause automation');
    expect(pauseIndex).toBeGreaterThan(0);
    expect(menu[pauseIndex - 1].type).toBe('separator');
    expect(menu[pauseIndex - 2].label).toBe('Presence: present');
  });

  it('offers "Settings…" with ⌘, (macOS convention) followed by Quit', () => {
    const onOpenSettings = vi.fn();
    new TrayController({
      resourcesPath,
      getHealth: () => 'running',
      onOpenSettings,
      onQuit: () => {},
    });
    const menu = trays[trays.length - 1].menu;
    const settingsIndex = menu.findIndex((i) => i.label === 'Settings…');
    expect(settingsIndex).toBeGreaterThan(0);
    const settings = menu[settingsIndex];
    expect(settings.accelerator).toBe('Command+,');
    expect(menu[settingsIndex - 1].type).toBe('separator');
    expect(menu[settingsIndex + 1].label).toBe('Quit Desk Agent');
    expect(menu.some((i) => i.label === 'Open Desk Agent Settings…')).toBe(false);
    (settings.click as () => void)();
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });
});

describe('Paired phone label', () => {
  beforeEach(() => {
    trays.length = 0;
  });

  it.each([
    [{ serial: 'abc123', model: 'OnePlus 6T' }, 'OnePlus 6T'],
    [{ serial: 'abc123', model: '  ' }, 'abc123'],
    [{ serial: 'abc123', model: null }, 'abc123'],
    [{ serial: 'abc123' }, 'abc123'],
    [{ serial: null, model: null }, 'none'],
  ] as const)('pairedPhoneName(%o) is "%s"', (device, expected) => {
    expect(pairedPhoneName(device as Parameters<typeof pairedPhoneName>[0])).toBe(expected);
  });

  it('the tray menu shows the model name when core has resolved it', () => {
    const snapshot = {
      device: { serial: 'abc123', model: 'OnePlus 6T', tunnelStatus: 'reissued' },
      clients: { connected: 1, lastHelloAt: null },
      presence: { state: 'present' },
      automation: { enabled: true },
    } as unknown as StatusSnapshot;
    new TrayController({
      resourcesPath,
      getHealth: () => 'running',
      getSnapshot: () => snapshot,
      onOpenSettings: () => {},
      onQuit: () => {},
    });
    const labels = trays[trays.length - 1].menu.map((i) => i.label);
    expect(labels).toContain('Paired phone: OnePlus 6T');
    expect(labels).not.toContain('Paired phone: abc123');
  });
});

describe('Disconnect phone display', () => {
  beforeEach(() => {
    trays.length = 0;
  });

  const connected = {
    device: { serial: 'abc123', tunnelStatus: 'reissued' },
    clients: { connected: 1, lastHelloAt: null },
    presence: { state: 'present' },
    automation: { enabled: true },
  } as unknown as StatusSnapshot;
  const disconnected = { ...connected, clients: { connected: 0, lastHelloAt: null } } as unknown as StatusSnapshot;

  const labels = () => trays[trays.length - 1].menu.map((i) => i.label);

  it.each([
    ['a snapshot', connected],
    ['no snapshot', null],
    ['the phone JSON link down', disconnected],
  ] as const)('shows Disconnect phone display only while a session is active (%s)', (_name, snapshot) => {
    let active = false;
    const controller = new TrayController({
      resourcesPath,
      getHealth: () => 'running',
      getSnapshot: () => snapshot,
      onOpenSettings: () => {},
      onToggleAutomation: () => {},
      getDisplayActive: () => active,
      onDisconnectDisplay: () => {},
      onQuit: () => {},
    });
    expect(labels()).not.toContain('Disconnect phone display');

    active = true;
    controller.refresh();
    const menu = trays[trays.length - 1].menu;
    const idx = menu.findIndex((i) => i.label === 'Disconnect phone display');
    expect(idx).toBeGreaterThan(0);
    // before the final separator + Settings/Quit
    expect(menu[idx + 1].type).toBe('separator');
    expect(menu[idx + 2].label).toBe('Settings…');
    // the status/automation block above stays intact
    if (snapshot) expect(menu.findIndex((i) => i.label?.startsWith('Phone app:'))).toBeLessThan(idx);

    active = false;
    controller.refresh();
    expect(labels()).not.toContain('Disconnect phone display');
  });

  it('Disconnect phone display calls onDisconnectDisplay', () => {
    const onDisconnectDisplay = vi.fn();
    new TrayController({
      resourcesPath,
      getHealth: () => 'running',
      getDisplayActive: () => true,
      onDisconnectDisplay,
      onOpenSettings: () => {},
      onQuit: () => {},
    });
    const item = trays[trays.length - 1].menu.find((i) => i.label === 'Disconnect phone display');
    (item?.click as () => void)();
    expect(onDisconnectDisplay).toHaveBeenCalledOnce();
  });
});

describe('TrayController after destroy', () => {
  it('refresh() after destroy() is a no-op, not a "Tray is destroyed" throw', () => {
    const controller = new TrayController({
      resourcesPath,
      getHealth: () => 'running',
      onOpenSettings: () => {},
      onQuit: () => {},
    });
    controller.destroy();
    expect(() => controller.refresh()).not.toThrow();
    expect(() => controller.destroy()).not.toThrow();
  });
});
