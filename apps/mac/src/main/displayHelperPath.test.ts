import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DISPLAY_HELPER_NAME, PACKAGED_HELPER_DIR, packagedDisplayHelperPath } from './displayHelperPath.js';

const pkg = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../package.json'), 'utf8'));

describe('packaged display helper location (F-O4)', () => {
  it('resolves to Contents/Helpers, not next to the Electron executable in Contents/MacOS', () => {
    const exec = '/Applications/Desk Agent.app/Contents/MacOS/Desk Agent';
    expect(packagedDisplayHelperPath(exec)).toBe('/Applications/Desk Agent.app/Contents/Helpers/desk-agent-display-helper');
  });

  it('matches where electron-builder puts the helper (extraFiles, relative to Contents)', () => {
    const entry = pkg.build.extraFiles.find((e: { filter?: string[] }) => e.filter?.includes(DISPLAY_HELPER_NAME));
    expect(entry?.to).toBe(PACKAGED_HELPER_DIR);
    expect(PACKAGED_HELPER_DIR).not.toBe('MacOS');
  });
});
