import { describe, it, expect } from 'vitest';
import { bumpPackageJson, bumpGradle } from './version-lib.mjs';

const GRADLE = `android {
    defaultConfig {
        applicationId "com.deskagentapp"
        versionCode 1
        versionName "1.0"
    }
}
`;

describe('bumpPackageJson', () => {
  it('sets the version field and preserves other fields', () => {
    const input = JSON.stringify({ name: '@desk-agent/mac', version: '0.1.0', private: true }, null, 2) + '\n';
    const out = bumpPackageJson(input, '0.5.0');
    const parsed = JSON.parse(out);
    expect(parsed.version).toBe('0.5.0');
    expect(parsed.name).toBe('@desk-agent/mac');
    expect(parsed.private).toBe(true);
    expect(out.endsWith('\n')).toBe(true);
  });

  it('rejects a non-semver version', () => {
    expect(() => bumpPackageJson('{"version":"0.1.0"}', 'v0.5.0')).toThrow(/semver/);
  });
});

describe('bumpGradle', () => {
  it('sets versionName and increments versionCode by 1', () => {
    const out = bumpGradle(GRADLE, '0.5.0');
    expect(out).toContain('versionCode 2');
    expect(out).toContain('versionName "0.5.0"');
    expect(out).not.toContain('versionName "1.0"');
  });

  it('increments from an arbitrary current versionCode', () => {
    const out = bumpGradle(GRADLE.replace('versionCode 1', 'versionCode 41'), '0.6.0');
    expect(out).toContain('versionCode 42');
  });

  it('leaves unrelated lines untouched', () => {
    const out = bumpGradle(GRADLE, '0.5.0');
    expect(out).toContain('applicationId "com.deskagentapp"');
  });

  it('throws when versionCode is missing', () => {
    expect(() => bumpGradle('versionName "1.0"', '0.5.0')).toThrow(/versionCode/);
  });

  it('throws when versionName is missing', () => {
    expect(() => bumpGradle('versionCode 1', '0.5.0')).toThrow(/versionName/);
  });

  it('rejects a non-semver version', () => {
    expect(() => bumpGradle(GRADLE, '0.5')).toThrow(/semver/);
  });
});
