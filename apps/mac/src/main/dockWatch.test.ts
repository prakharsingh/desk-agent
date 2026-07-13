import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  buildWatchScript,
  buildPlist,
  scriptPath,
  plistPath,
  logPath,
  isInstalled,
  install,
  uninstall,
} from './dockWatch.js';

describe('dockWatch', () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  function tmpHomeDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-agent-dockwatch-'));
    tmpDirs.push(dir);
    return dir;
  }

  describe('buildWatchScript', () => {
    it('checks every candidate dir for an executable adb, in order', () => {
      const script = buildWatchScript(['/opt/homebrew/bin', '/usr/local/bin']);
      expect(script).toContain('if [ -z "$ADB" ] && [ -x "/opt/homebrew/bin/adb" ]; then ADB="/opt/homebrew/bin/adb"; fi');
      expect(script).toContain('if [ -z "$ADB" ] && [ -x "/usr/local/bin/adb" ]; then ADB="/usr/local/bin/adb"; fi');
    });

    it('falls back to PATH resolution, then gives up if adb is nowhere to be found', () => {
      const script = buildWatchScript([]);
      expect(script).toContain('ADB=$(command -v adb 2>/dev/null || true)');
      expect(script).toContain('dock-watch: adb not found');
      expect(script).toContain('exit 1');
    });

    it('waits for device, focuses the app by bundle id, then waits for disconnect before exiting', () => {
      const script = buildWatchScript([]);
      const waitForDeviceIdx = script.indexOf('"$ADB" wait-for-device');
      const openIdx = script.indexOf('open -b com.deskagent.mac');
      const waitForDisconnectIdx = script.indexOf('"$ADB" wait-for-disconnect');
      expect(waitForDeviceIdx).toBeGreaterThan(-1);
      expect(openIdx).toBeGreaterThan(waitForDeviceIdx);
      expect(waitForDisconnectIdx).toBeGreaterThan(openIdx);
    });
  });

  describe('buildPlist', () => {
    it('points ProgramArguments at /bin/sh and the given script path', () => {
      const plist = buildPlist('/some/script.sh', '/some/log.log');
      expect(plist).toContain('<string>/bin/sh</string>');
      expect(plist).toContain('<string>/some/script.sh</string>');
    });

    it('sets RunAtLoad and KeepAlive so launchd starts it now and re-arms it after every dock/undock cycle', () => {
      const plist = buildPlist('/some/script.sh', '/some/log.log');
      expect(plist).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
      expect(plist).toMatch(/<key>KeepAlive<\/key>\s*<true\/>/);
    });

    it('routes stdout and stderr to the given log path', () => {
      const plist = buildPlist('/some/script.sh', '/some/log.log');
      expect(plist).toContain('<key>StandardOutPath</key>\n  <string>/some/log.log</string>');
      expect(plist).toContain('<key>StandardErrorPath</key>\n  <string>/some/log.log</string>');
    });
  });

  describe('isInstalled', () => {
    it('is false when no plist exists at the given home dir', () => {
      expect(isInstalled(tmpHomeDir())).toBe(false);
    });

    it('is true once a plist file exists at the expected path', () => {
      const homeDir = tmpHomeDir();
      fs.mkdirSync(path.dirname(plistPath(homeDir)), { recursive: true });
      fs.writeFileSync(plistPath(homeDir), '<plist/>');
      expect(isInstalled(homeDir)).toBe(true);
    });
  });

  describe('install', () => {
    it('writes an executable watch script and a plist, and reports installed afterward', () => {
      const homeDir = tmpHomeDir();
      const launchctlCalls: string[][] = [];
      const result = install({ homeDir, runLaunchctl: (args) => launchctlCalls.push(args) });

      expect(result).toBe(true);
      expect(fs.existsSync(scriptPath(homeDir))).toBe(true);
      expect(fs.existsSync(plistPath(homeDir))).toBe(true);
      expect(fs.statSync(scriptPath(homeDir)).mode & 0o111).not.toBe(0); // executable bit set

      const plistContent = fs.readFileSync(plistPath(homeDir), 'utf8');
      expect(plistContent).toContain(scriptPath(homeDir));
    });

    it('bootouts any prior registration before bootstrapping fresh, so re-enabling never leaves a stale service loaded', () => {
      const homeDir = tmpHomeDir();
      const launchctlCalls: string[][] = [];
      install({ homeDir, runLaunchctl: (args) => launchctlCalls.push(args) });

      expect(launchctlCalls[0][0]).toBe('bootout');
      expect(launchctlCalls[1][0]).toBe('bootstrap');
    });

    it('still reports the real on-disk state even if launchctl itself throws', () => {
      const homeDir = tmpHomeDir();
      const result = install({
        homeDir,
        runLaunchctl: () => {
          throw new Error('launchctl unavailable in this sandbox');
        },
      });
      // The plist is still written even though launchctl failed -- isInstalled()
      // reflects that real state (file-existence signal), not launchctl's outcome.
      expect(result).toBe(true);
      expect(fs.existsSync(plistPath(homeDir))).toBe(true);
    });
  });

  describe('uninstall', () => {
    it('removes the plist and reports not installed afterward', () => {
      const homeDir = tmpHomeDir();
      install({ homeDir, runLaunchctl: () => {} });
      expect(isInstalled(homeDir)).toBe(true);

      const result = uninstall({ homeDir, runLaunchctl: () => {} });
      expect(result).toBe(false);
      expect(fs.existsSync(plistPath(homeDir))).toBe(false);
    });

    it('does not throw if nothing was installed to begin with', () => {
      const homeDir = tmpHomeDir();
      expect(() => uninstall({ homeDir, runLaunchctl: () => { throw new Error('not loaded'); } })).not.toThrow();
      expect(isInstalled(homeDir)).toBe(false);
    });
  });
});
