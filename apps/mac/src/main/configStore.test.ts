import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readConfig, writeConfig } from './configStore.js';

describe('configStore', () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  function tmpConfigPath() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-agent-configstore-'));
    tmpDirs.push(dir);
    return path.join(dir, 'config.json');
  }

  it('round-trips a config written by writeConfig back through readConfig', () => {
    const configPath = tmpConfigPath();
    writeConfig(configPath, { wsPort: 9999, weather: { location: 'Portland' } });
    const read = readConfig(configPath);
    expect(read.wsPort).toBe(9999);
    expect(read.weather.location).toBe('Portland');
  });

  it('applies schema defaults on read for an older on-disk config missing newer fields (upgrade path)', () => {
    const configPath = tmpConfigPath();
    fs.writeFileSync(configPath, JSON.stringify({ weather: { location: 'Seattle' } }));
    const read = readConfig(configPath);
    expect(read.watchdogTimeoutMs).toBe(30000);
    expect(read.weather.intervalMs).toBe(600_000);
  });

  it('writeConfig rejects invalid input and does not touch the file at all', () => {
    const configPath = tmpConfigPath();
    writeConfig(configPath, { wsPort: 9999 });
    expect(() => writeConfig(configPath, { wsPort: 'not-a-number' })).toThrow();
    // The rejected write must not have clobbered the last-good config.
    expect(readConfig(configPath).wsPort).toBe(9999);
  });

  it('writeConfig leaves no leftover temp file after a successful write', () => {
    const configPath = tmpConfigPath();
    writeConfig(configPath, {});
    const dirContents = fs.readdirSync(path.dirname(configPath));
    expect(dirContents).toEqual(['config.json']);
  });

  it('writeConfig returns the validated, defaulted config it wrote', () => {
    const configPath = tmpConfigPath();
    const result = writeConfig(configPath, { wsPort: 1234 });
    expect(result.wsPort).toBe(1234);
    expect(result.presence.wakeEnabled).toBe(true);
  });
});
