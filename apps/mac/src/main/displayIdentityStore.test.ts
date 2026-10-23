import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DisplayIdentityStore } from './displayIdentityStore.js';

describe('DisplayIdentityStore', () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'display-identity-'));
    file = path.join(dir, 'display-identity.json');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('starts every phone at generation 0 when nothing is saved', () => {
    expect(new DisplayIdentityStore(file).getGeneration('b8af4884')).toBe(0);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('persists a generation per phone and leaves other phones alone', () => {
    const a = new DisplayIdentityStore(file);
    a.setGeneration('b8af4884', 1);
    a.setGeneration('0000002a', 3);
    const b = new DisplayIdentityStore(file);
    expect(b.getGeneration('b8af4884')).toBe(1);
    expect(b.getGeneration('0000002a')).toBe(3);
    expect(b.getGeneration('ffffffff')).toBe(0);
  });

  it('writes atomically through a sibling temp file and leaves none behind', () => {
    new DisplayIdentityStore(file).setGeneration('b8af4884', 2);
    expect(fs.readdirSync(dir)).toEqual(['display-identity.json']);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ version: 1, generations: { b8af4884: 2 } });
  });

  it('creates the directory when it is missing', () => {
    const nested = path.join(dir, 'a', 'b', 'display-identity.json');
    new DisplayIdentityStore(nested).setGeneration('b8af4884', 1);
    expect(new DisplayIdentityStore(nested).getGeneration('b8af4884')).toBe(1);
  });

  it('treats an unreadable or invalid file as generation 0 (and never throws on read)', () => {
    fs.writeFileSync(file, 'not json');
    expect(new DisplayIdentityStore(file).getGeneration('b8af4884')).toBe(0);
    fs.writeFileSync(file, JSON.stringify({ version: 1, generations: { b8af4884: -1 } }));
    expect(new DisplayIdentityStore(file).getGeneration('b8af4884')).toBe(0);
  });

  it('refuses an invalid generation without touching disk', () => {
    const s = new DisplayIdentityStore(file);
    s.setGeneration('b8af4884', 1);
    expect(() => s.setGeneration('b8af4884', -1)).toThrow();
    expect(() => s.setGeneration('b8af4884', 1.5)).toThrow();
    expect(s.getGeneration('b8af4884')).toBe(1);
  });
});
