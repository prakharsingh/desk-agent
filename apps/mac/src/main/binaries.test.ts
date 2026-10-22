import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { findBinary, checkBinaries, augmentedPath, resolveAdb } from './binaries.js';

describe('binaries', () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  function makeFakeBinDir(name: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-agent-binaries-'));
    tmpDirs.push(dir);
    fs.writeFileSync(path.join(dir, name), '#!/bin/sh\n');
    fs.chmodSync(path.join(dir, name), 0o755);
    return dir;
  }

  describe('findBinary', () => {
    it('returns the absolute path when found in one of the candidate dirs', () => {
      const dir = makeFakeBinDir('adb');
      expect(findBinary('adb', [dir])).toBe(path.join(dir, 'adb'));
    });

    it('returns null when not found in any candidate dir', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-agent-binaries-empty-'));
      tmpDirs.push(dir);
      expect(findBinary('adb', [dir])).toBeNull();
    });

    it('checks candidate dirs in order and returns the first match', () => {
      const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-agent-binaries-'));
      tmpDirs.push(dir1);
      const dir2 = makeFakeBinDir('adb');
      expect(findBinary('adb', [dir1, dir2])).toBe(path.join(dir2, 'adb'));
    });
  });

  describe('checkBinaries', () => {
    it('reports found/not-found for adb and nowplaying-cli independently', () => {
      const dir = makeFakeBinDir('adb');
      const result = checkBinaries([dir]);
      expect(result.adb).toBe(true);
      expect(result.nowplayingCli).toBe(false);
    });
  });

  describe('resolveAdb', () => {
    it('prefers the user adb over the bundled one', () => {
      const userDir = makeFakeBinDir('adb');
      const bundledDir = makeFakeBinDir('adb');
      expect(resolveAdb({ candidateDirs: [userDir], pathEnv: '', bundledPath: path.join(bundledDir, 'adb') })).toEqual({
        path: path.join(userDir, 'adb'),
        source: 'user',
      });
    });

    it('finds a user adb on PATH', () => {
      const pathDir = makeFakeBinDir('adb');
      expect(resolveAdb({ candidateDirs: [], pathEnv: `/nonexistent:${pathDir}`, bundledPath: null })).toEqual({
        path: path.join(pathDir, 'adb'),
        source: 'user',
      });
    });

    it('falls back to the bundled adb', () => {
      const bundledDir = makeFakeBinDir('adb');
      const bundled = path.join(bundledDir, 'adb');
      expect(resolveAdb({ candidateDirs: [], pathEnv: '', bundledPath: bundled })).toEqual({ path: bundled, source: 'bundled' });
    });

    it('returns null when neither exists', () => {
      expect(resolveAdb({ candidateDirs: [], pathEnv: '', bundledPath: '/definitely/not/here/adb' })).toBeNull();
      expect(resolveAdb({ candidateDirs: [], pathEnv: '', bundledPath: null })).toBeNull();
    });

    it('ignores a non-executable adb', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-agent-binaries-'));
      tmpDirs.push(dir);
      fs.writeFileSync(path.join(dir, 'adb'), 'x');
      expect(resolveAdb({ candidateDirs: [dir], pathEnv: '', bundledPath: null })).toBeNull();
    });
  });

  describe('checkBinaries adb details', () => {
    it('reports the resolved adb path and source', () => {
      const dir = makeFakeBinDir('adb');
      const result = checkBinaries([dir], { path: path.join(dir, 'adb'), source: 'bundled' });
      expect(result).toMatchObject({ adb: true, adbPath: path.join(dir, 'adb'), adbSource: 'bundled' });
      expect(checkBinaries([dir], null)).toMatchObject({ adb: false, adbPath: null, adbSource: null });
    });
  });

  describe('augmentedPath', () => {
    it('prepends every candidate dir that actually exists on disk to the given PATH', () => {
      const dir = makeFakeBinDir('adb');
      const result = augmentedPath('/usr/bin:/bin', [dir, '/definitely/does/not/exist']);
      expect(result).toBe(`${dir}:/usr/bin:/bin`);
    });

    it('does not duplicate a candidate dir already present in PATH', () => {
      const dir = makeFakeBinDir('adb');
      const result = augmentedPath(`${dir}:/usr/bin`, [dir]);
      expect(result).toBe(`${dir}:/usr/bin`);
    });
  });
});
