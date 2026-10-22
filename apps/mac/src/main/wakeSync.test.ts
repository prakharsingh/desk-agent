import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readConfig, writeConfig } from './configStore.js';
import { WakeSync } from './wakeSync.js';
import { WakeSetting, type ToApp, type ToCore } from '@desk-agent/core';

describe('WakeSync', () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  function setup(wakeEnabled: boolean) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-agent-wakesync-'));
    tmpDirs.push(dir);
    const configPath = path.join(dir, 'config.json');
    writeConfig(configPath, { weather: { location: 'Seattle' }, presence: { wakeEnabled } });
    const sendToCore = vi.fn();
    const notifyRenderer = vi.fn();
    const sync = new WakeSync({ configPath, sendToCore, notifyRenderer });
    return { configPath, sync, sendToCore, notifyRenderer };
  }

  it('Mac toggle: persists presence.wakeEnabled to config.json and sends ToCore setWakeEnabled (live, no restart)', () => {
    const { configPath, sync, sendToCore } = setup(true);
    const written = sync.setFromMac(false);
    expect(written.presence.wakeEnabled).toBe(false);
    expect(readConfig(configPath).presence.wakeEnabled).toBe(false);
    // The ONLY thing sent to core is the live update -- no restart path exists here.
    expect(sendToCore).toHaveBeenCalledTimes(1);
    expect(sendToCore).toHaveBeenCalledWith({ kind: 'setWakeEnabled', enabled: false });
  });

  it('Mac toggle leaves every other config field untouched', () => {
    const { configPath, sync } = setup(true);
    sync.setFromMac(false);
    expect(readConfig(configPath).weather.location).toBe('Seattle');
  });

  it('phone toggle (ToApp wakeEnabledChanged): persists to config.json and pushes the new config to the renderer, never echoing to core', () => {
    const { configPath, sync, sendToCore, notifyRenderer } = setup(true);
    const handled = sync.handleCoreMessage({ kind: 'wakeEnabledChanged', enabled: false, source: 'phone' });
    expect(handled).toBe(true);
    expect(readConfig(configPath).presence.wakeEnabled).toBe(false);
    expect(notifyRenderer).toHaveBeenCalledWith(expect.objectContaining({ presence: expect.objectContaining({ wakeEnabled: false }) }));
    expect(sendToCore).not.toHaveBeenCalled();
  });

  it('renderer config:set keeps the on-disk wakeEnabled (a stale full-config save cannot undo a phone toggle)', () => {
    const { configPath, sync, sendToCore } = setup(true);
    // Renderer last saw wake=true; the phone then turns it off (persisted via core's report).
    sync.handleCoreMessage({ kind: 'wakeEnabledChanged', enabled: false, source: 'phone' });
    // An unrelated settings save from that stale render still carries wake=true.
    const written = sync.writeRendererConfig({ weather: { location: 'Paris' }, presence: { wakeEnabled: true } });
    expect(written.presence.wakeEnabled).toBe(false);
    expect(written.weather.location).toBe('Paris');
    const onDisk = readConfig(configPath);
    expect(onDisk.presence.wakeEnabled).toBe(false);
    expect(onDisk.weather.location).toBe('Paris');
    expect(sendToCore).not.toHaveBeenCalled();
  });

  it('renderer config:set rejects an invalid config without touching disk', () => {
    const { configPath, sync } = setup(true);
    const before = fs.readFileSync(configPath, 'utf8');
    expect(() => sync.writeRendererConfig({ presence: { wakeEnabled: 'yes' } })).toThrow();
    expect(fs.readFileSync(configPath, 'utf8')).toBe(before);
  });

  it('renderer config:set falls back to the renderer value when the on-disk config is unreadable', () => {
    const { configPath, sync } = setup(true);
    fs.writeFileSync(configPath, '{not json');
    const written = sync.writeRendererConfig({ weather: { location: 'Paris' }, presence: { wakeEnabled: false } });
    expect(written.presence.wakeEnabled).toBe(false);
    expect(readConfig(configPath).presence.wakeEnabled).toBe(false);
  });

  it('ignores unrelated core messages', () => {
    const { sync, notifyRenderer } = setup(true);
    expect(sync.handleCoreMessage({ kind: 'log', entry: { ts: 0, level: 'info', source: 'x', message: 'y' } })).toBe(false);
    expect(notifyRenderer).not.toHaveBeenCalled();
  });

  it('a core report equal to what is already persisted is a no-op (no write, no renderer push) -- e.g. the echo of a Mac toggle', () => {
    const { configPath, sync, notifyRenderer } = setup(true);
    sync.setFromMac(false);
    const mtimeBefore = fs.statSync(configPath).mtimeMs;
    const before = fs.readFileSync(configPath, 'utf8');
    expect(sync.handleCoreMessage({ kind: 'wakeEnabledChanged', enabled: false, source: 'mac' })).toBe(true);
    expect(fs.readFileSync(configPath, 'utf8')).toBe(before);
    expect(fs.statSync(configPath).mtimeMs).toBe(mtimeBefore);
    expect(notifyRenderer).not.toHaveBeenCalled();
  });

  it('a Mac-sourced core report that differs from config.json is persisted too (core is authoritative)', () => {
    const { configPath, sync, notifyRenderer } = setup(true);
    sync.handleCoreMessage({ kind: 'wakeEnabledChanged', enabled: false, source: 'mac' });
    expect(readConfig(configPath).presence.wakeEnabled).toBe(false);
    expect(notifyRenderer).toHaveBeenCalledTimes(1);
  });

  // The race the review found: core applies a phone toggle and its report is
  // still in flight when the Mac UI sends a different value. With only
  // phone-sourced reports, main would persist the late phone value and
  // config.json would disagree with core forever. Modeled with the REAL core
  // WakeSetting and FIFO queues for each IPC direction.
  describe('simultaneous Mac + phone toggles converge (config.json == core)', () => {
    function rig(initial: boolean) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-agent-wakesync-race-'));
      tmpDirs.push(dir);
      const configPath = path.join(dir, 'config.json');
      writeConfig(configPath, { presence: { wakeEnabled: initial } });
      const toCore: ToCore[] = [];
      const toApp: ToApp[] = [];
      const phone: boolean[] = [];
      const core = new WakeSetting(initial, {
        sendToPhone: (e) => phone.push(e),
        notifyApp: (enabled, source) => toApp.push({ kind: 'wakeEnabledChanged', enabled, source }),
      });
      const mac = new WakeSync({ configPath, sendToCore: (m) => toCore.push(m), notifyRenderer: () => {} });
      return {
        configPath,
        core,
        phone,
        macToggle: (enabled: boolean) => mac.setFromMac(enabled),
        phoneToggle: (enabled: boolean) => core.set(enabled, 'phone'),
        deliverToCore: () => {
          for (const m of toCore.splice(0)) if (m.kind === 'setWakeEnabled') core.set(m.enabled, 'mac');
        },
        deliverToApp: () => {
          for (const m of toApp.splice(0)) mac.handleCoreMessage(m);
        },
      };
    }

    it('phone applied first (report in flight), then a Mac toggle to the other value', () => {
      const r = rig(true);
      r.phoneToggle(false); // core=false, report(false, phone) queued
      r.macToggle(true); // config optimistic true, ToCore true queued
      r.deliverToCore(); // core=true, report(true, mac) queued
      r.deliverToApp(); // main persists false, then true
      expect(r.core.get()).toBe(true);
      expect(readConfig(r.configPath).presence.wakeEnabled).toBe(r.core.get());
      expect(r.phone.at(-1)).toBe(r.core.get());
    });

    it('Mac toggle first, phone toggle lands at core before the Mac message', () => {
      const r = rig(true);
      r.macToggle(false); // config=false, ToCore false queued
      r.phoneToggle(true); // core: unchanged (true) -> no-op
      r.phoneToggle(false); // core=false (phone)
      r.phoneToggle(true); // core=true (phone)
      r.deliverToCore(); // core=false (mac)
      r.deliverToApp();
      expect(r.core.get()).toBe(false);
      expect(readConfig(r.configPath).presence.wakeEnabled).toBe(r.core.get());
      expect(r.phone.at(-1)).toBe(r.core.get());
    });

    it('Mac app receives reports one at a time while more Mac toggles are queued', () => {
      const r = rig(false);
      r.macToggle(true); // config=true, ToCore true queued
      r.phoneToggle(true); // core=true (phone), report queued
      r.deliverToApp(); // persists true (already true -> no write)
      r.macToggle(false); // config=false, ToCore false queued
      r.deliverToCore(); // core: true (mac, no-op), then false (mac)
      r.phoneToggle(true); // core=true
      r.deliverToApp();
      expect(readConfig(r.configPath).presence.wakeEnabled).toBe(r.core.get());
      expect(r.phone.at(-1)).toBe(r.core.get());
    });
  });
});

