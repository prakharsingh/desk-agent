import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const signApp = vi.fn(async () => ({ mode: 'adhoc', signed: ['a', ''] }));
const defaultExec = vi.fn();
vi.mock('./sign.mjs', () => ({ signApp, defaultExec }));

// @ts-expect-error plain ESM without types
const { default: afterPack } = await import('./afterPack.mjs');

const ctx = (platform: string) => ({
  electronPlatformName: platform,
  appOutDir: '/out/mac-arm64',
  packager: { appInfo: { productFilename: 'Desk Agent' } },
});

describe('afterPack', () => {
  beforeEach(() => {
    signApp.mockClear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('signs <appOutDir>/<productFilename>.app with the process env and the real exec on darwin', async () => {
    await afterPack(ctx('darwin'));
    expect(signApp).toHaveBeenCalledTimes(1);
    expect(signApp).toHaveBeenCalledWith(path.join('/out/mac-arm64', 'Desk Agent.app'), {
      env: process.env,
      exec: defaultExec,
    });
  });

  it('does nothing on other platforms', async () => {
    await afterPack(ctx('linux'));
    await afterPack(ctx('win32'));
    expect(signApp).not.toHaveBeenCalled();
  });

  it('lets a signing failure fail the pack', async () => {
    signApp.mockRejectedValueOnce(new Error('codesign failed'));
    await expect(afterPack(ctx('darwin'))).rejects.toThrow(/codesign failed/);
  });
});
