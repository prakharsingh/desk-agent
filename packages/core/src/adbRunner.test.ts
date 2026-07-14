import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRealAdbRunner } from './adbRunner.js';

describe('createRealAdbRunner', () => {
  it('logs an error and does not crash when the adb binary is missing', async () => {
    const onLog = vi.fn();
    const runner = createRealAdbRunner(onLog, '/nonexistent/definitely-not-adb');
    const tracker = runner.trackDevices(() => {});
    await vi.waitFor(() => expect(onLog).toHaveBeenCalledWith('error', expect.stringContaining('adb')));
    expect(() => tracker.stop()).not.toThrow();
  });

  describe('launchApp', () => {
    // A real stub "adb" script (not a mocked execFile) recording the argv it
    // was invoked with, matching this file's existing style of exercising
    // createRealAdbRunner against a real binary path rather than mocking
    // node:child_process.
    function stubAdb(): { adbPath: string; argsFile: string } {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-agent-adb-stub-'));
      const adbPath = path.join(dir, 'adb');
      const argsFile = path.join(dir, 'args');
      fs.writeFileSync(adbPath, '#!/bin/sh\nprintf \'%s\\n\' "$@" > "' + argsFile + '"\n');
      fs.chmodSync(adbPath, 0o755);
      return { adbPath, argsFile };
    }

    it('starts com.deskagentapp/.MainActivity, scoped to the given serial', async () => {
      const { adbPath, argsFile } = stubAdb();
      const runner = createRealAdbRunner(vi.fn(), adbPath);
      await runner.launchApp('phone1');
      const args = fs.readFileSync(argsFile, 'utf8').trim().split('\n');
      expect(args).toEqual(['-s', 'phone1', 'shell', 'am', 'start', '-n', 'com.deskagentapp/.MainActivity']);
    });

    it('omits -s <serial> when no serial is known', async () => {
      const { adbPath, argsFile } = stubAdb();
      const runner = createRealAdbRunner(vi.fn(), adbPath);
      await runner.launchApp(null);
      const args = fs.readFileSync(argsFile, 'utf8').trim().split('\n');
      expect(args).toEqual(['shell', 'am', 'start', '-n', 'com.deskagentapp/.MainActivity']);
    });

    it('rejects when the adb binary is missing (caller/TunnelSupervisor handles the failure)', async () => {
      const runner = createRealAdbRunner(vi.fn(), '/nonexistent/definitely-not-adb');
      await expect(runner.launchApp('phone1')).rejects.toThrow();
    });
  });
});
