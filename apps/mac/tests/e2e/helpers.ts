import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { _electron as electron } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Exercises the actual electron-builder output (not `electron-vite dev`),
// per the Phase 0 finding that packaging behaves differently from dev mode
// (asar paths, externalized deps, extraResources). Run `pnpm pack` first.
function findPackagedApp(): string {
  const arch = process.arch === 'arm64' ? 'mac-arm64' : 'mac';
  const appDir = path.resolve(__dirname, '../../release', arch);
  const appBundle = path.join(appDir, 'Desk Agent.app');
  if (!fs.existsSync(appBundle)) {
    throw new Error(`Packaged app not found at ${appBundle} -- run "pnpm pack" in apps/mac first.`);
  }
  return appBundle;
}

function copyOutsideRepo(appBundlePath: string, workDir: string): string {
  const destBundle = path.join(workDir, 'Desk Agent.app');
  // Phase 0 also found that testing a build from inside the monorepo risks
  // require.resolve() escaping the asar into the real on-disk node_modules,
  // masking a packaging bug -- so this copies the built .app to a tmp dir
  // outside the repo before launching it, matching the spike's methodology.
  //
  // fs.cpSync breaks the .app bundle's internal Framework symlinks (observed:
  // Electron fails with "icudtl.dat not found in bundle" / GPU process
  // crashes on launch). Shell `cp -R` preserves them correctly.
  execFileSync('cp', ['-R', appBundlePath, destBundle]);
  return destBundle;
}

export interface IsolatedApp {
  electronApp: Awaited<ReturnType<typeof electron.launch>>;
  /** The isolated $HOME this instance was launched with -- ~/.desk-agent/config.json lives under here, never the real user's home. */
  homeDir: string;
  close(): Promise<void>;
}

// Every packaged e2e test needs the same two isolations: the .app copy
// outside the repo (see copyOutsideRepo), and an isolated $HOME so
// defaultConfigPath() (os.homedir()-based) never reads or writes the real
// developer's ~/.desk-agent/config.json.
export async function launchIsolatedApp(): Promise<IsolatedApp> {
  const appBundle = findPackagedApp();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-agent-mac-e2e-'));
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-agent-mac-e2e-home-'));

  try {
    const isolatedBundle = copyOutsideRepo(appBundle, workDir);
    const executablePath = path.join(isolatedBundle, 'Contents/MacOS/Desk Agent');
    const electronApp = await electron.launch({ executablePath, env: { ...process.env, HOME: homeDir } });
    return {
      electronApp,
      homeDir,
      close: async () => {
        await electronApp.close();
        fs.rmSync(workDir, { recursive: true, force: true });
        fs.rmSync(homeDir, { recursive: true, force: true });
      },
    };
  } catch (err) {
    // Launch (or the copy preceding it) failed -- nothing to await close()
    // on, so clean up both tmp dirs here instead of leaking them.
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
    throw err;
  }
}
