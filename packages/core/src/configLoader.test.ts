import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, loadConfigFromFile } from './index.js';

describe('loadConfig', () => {
  it('applies sane defaults when optional fields are omitted', () => {
    const config = loadConfig({ weather: { apiKey: 'k', location: 'Seattle' } });
    expect(config.enabledPlugins).toEqual(['system-stats', 'weather', 'energy-saver']);
    expect(config.presenceDebounceMs).toBe(30000);
    expect(config.wsPort).toBe(8787);
  });

  it('accepts fully specified config', () => {
    const config = loadConfig({
      enabledPlugins: ['weather'],
      weather: { apiKey: 'k', location: 'Seattle' },
      presenceDebounceMs: 5000,
      wsPort: 9000,
    });
    expect(config.enabledPlugins).toEqual(['weather']);
    expect(config.wsPort).toBe(9000);
  });

  it('throws with a descriptive message when weather config is missing', () => {
    expect(() => loadConfig({})).toThrow();
  });

  it('applies sane defaults for the presence block when omitted', () => {
    const config = loadConfig({ weather: { apiKey: 'k', location: 'Seattle' } });
    expect(config.presence).toEqual({
      absenceTimeoutMs: 300000,
      gazeIsKeepAwake: true,
      bootConfirmationTimeoutMs: 300000,
      wakeEnabled: true,
    });
  });

  it('accepts a fully specified presence block', () => {
    const config = loadConfig({
      weather: { apiKey: 'k', location: 'Seattle' },
      presence: { absenceTimeoutMs: 60000, gazeIsKeepAwake: false, bootConfirmationTimeoutMs: 60000 },
    });
    expect(config.presence.absenceTimeoutMs).toBe(60000);
    expect(config.presence.gazeIsKeepAwake).toBe(false);
  });

  it('defaults wakeEnabled to true when the presence block is omitted', () => {
    const config = loadConfig({ weather: { apiKey: 'k', location: 'Seattle' } });
    expect(config.presence.wakeEnabled).toBe(true);
  });

  it('accepts an explicit wakeEnabled: false', () => {
    const config = loadConfig({
      weather: { apiKey: 'k', location: 'Seattle' },
      presence: { wakeEnabled: false },
    });
    expect(config.presence.wakeEnabled).toBe(false);
  });
});

describe('loadConfigFromFile', () => {
  const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'desk-agent-config-'));

  it('loads and validates a config file', () => {
    const configPath = path.join(tmpDir(), 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ weather: { apiKey: 'k', location: 'Seattle' } }));
    const config = loadConfigFromFile(configPath);
    expect(config.wsPort).toBe(8787);
  });

  it('throws an error naming the resolved path and the fix when the file is missing', () => {
    const configPath = path.join(tmpDir(), 'config.json');
    expect(() => loadConfigFromFile(configPath)).toThrow(configPath);
    expect(() => loadConfigFromFile(configPath)).toThrow(/config\.example\.json/);
  });

  it('throws an error naming the resolved path when the file is not valid JSON', () => {
    const configPath = path.join(tmpDir(), 'config.json');
    fs.writeFileSync(configPath, '{ not json');
    expect(() => loadConfigFromFile(configPath)).toThrow(configPath);
    expect(() => loadConfigFromFile(configPath)).toThrow(/not valid JSON/);
  });
});
