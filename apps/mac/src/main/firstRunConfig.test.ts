import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ensureConfigExists, reconcileWidgetsOnDisk } from './firstRunConfig.js';

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

describe('reconcileWidgetsOnDisk', () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeTmp(contents: string) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-agent-reconcile-'));
    tmpDirs.push(dir);
    const configPath = path.join(dir, 'config.json');
    fs.writeFileSync(configPath, contents);
    return configPath;
  }

  it('writes once then not again', () => {
    const configPath = writeTmp(JSON.stringify({ wsPort: 9000, visibleWidgets: ['clock', 'weather'] }));
    expect(reconcileWidgetsOnDisk(configPath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(parsed.visibleWidgets).toEqual(['clock', 'weather', 'display']);
    expect(parsed.knownWidgets).toContain('display');
    expect(parsed.wsPort).toBe(9000);

    const before = { text: fs.readFileSync(configPath, 'utf8'), mtime: fs.statSync(configPath).mtimeMs };
    expect(reconcileWidgetsOnDisk(configPath)).toBe(false);
    expect(fs.readFileSync(configPath, 'utf8')).toBe(before.text);
    expect(fs.statSync(configPath).mtimeMs).toBe(before.mtime);
    expect(fs.readdirSync(path.dirname(configPath))).toEqual(['config.json']);
  });

  it('leaves an unparseable file alone', () => {
    const configPath = writeTmp('{ not json');
    expect(reconcileWidgetsOnDisk(configPath)).toBe(false);
    expect(fs.readFileSync(configPath, 'utf8')).toBe('{ not json');
  });

  it('does nothing when the file is missing or not a JSON object', () => {
    const missing = path.join(os.tmpdir(), 'desk-agent-definitely-missing', 'config.json');
    expect(reconcileWidgetsOnDisk(missing)).toBe(false);
    const arr = writeTmp('[]');
    expect(reconcileWidgetsOnDisk(arr)).toBe(false);
    expect(fs.readFileSync(arr, 'utf8')).toBe('[]');
  });
});
