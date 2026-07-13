import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ensureConfigExists } from './firstRunConfig.js';

describe('ensureConfigExists', () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  function tmpConfigPath() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-agent-firstrun-'));
    tmpDirs.push(dir);
    return path.join(dir, 'nested', 'config.json');
  }

  it('writes a valid default config (parseable by the core schema shape) when none exists', () => {
    const configPath = tmpConfigPath();
    ensureConfigExists(configPath);
    expect(fs.existsSync(configPath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(parsed.weather.location).toBeTypeOf('string');
    expect(Array.isArray(parsed.enabledPlugins)).toBe(true);
    expect(typeof parsed.wsPort).toBe('number');
  });

  it('does not overwrite an existing config', () => {
    const configPath = tmpConfigPath();
    ensureConfigExists(configPath);
    fs.writeFileSync(configPath, JSON.stringify({ custom: true }));
    ensureConfigExists(configPath);
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(parsed).toEqual({ custom: true });
  });
});
