import { describe, it, expect, vi, afterEach } from 'vitest';
import { isNewerVersion, fetchLatestRelease, startUpdateChecker } from './updateCheck.js';

const release = (tag: string) =>
  ({ ok: true, json: async () => ({ tag_name: tag, html_url: `https://github.com/prakharsingh/desk-agent/releases/tag/${tag}` }) }) as Response;

describe('isNewerVersion', () => {
  it('detects newer minor and major versions', () => {
    expect(isNewerVersion('0.3.0', '0.4.0')).toBe(true);
    expect(isNewerVersion('0.9.0', '1.0.0')).toBe(true);
  });
  it('is false for same or older versions', () => {
    expect(isNewerVersion('0.4.0', '0.4.0')).toBe(false);
    expect(isNewerVersion('0.4.1', '0.4.0')).toBe(false);
  });
  it('tolerates a leading v on either side', () => {
    expect(isNewerVersion('v0.3.0', 'v0.4.0')).toBe(true);
  });
});

describe('fetchLatestRelease', () => {
  it('parses tag_name and html_url', async () => {
    const info = await fetchLatestRelease(vi.fn(async () => release('v0.4.0')));
    expect(info).toEqual({ version: '0.4.0', url: 'https://github.com/prakharsingh/desk-agent/releases/tag/v0.4.0' });
  });
  it('returns null on non-OK response', async () => {
    const info = await fetchLatestRelease(vi.fn(async () => ({ ok: false }) as Response));
    expect(info).toBeNull();
  });
  it('returns null when fetch throws (offline is normal, never throws)', async () => {
    const info = await fetchLatestRelease(vi.fn(async () => { throw new Error('offline'); }));
    expect(info).toBeNull();
  });
  it('returns null on malformed body', async () => {
    const info = await fetchLatestRelease(vi.fn(async () => ({ ok: true, json: async () => ({}) }) as Response));
    expect(info).toBeNull();
  });
});

describe('startUpdateChecker', () => {
  afterEach(() => vi.useRealTimers());

  it('announces a newer release once and exposes it via getAvailable', async () => {
    const onUpdateAvailable = vi.fn();
    const checker = startUpdateChecker({
      currentVersion: '0.3.0',
      onUpdateAvailable,
      fetchFn: vi.fn(async () => release('v0.4.0')),
      intervalMs: 60_000,
    });
    await vi.waitFor(() => expect(onUpdateAvailable).toHaveBeenCalledTimes(1));
    expect(checker.getAvailable()).toEqual({ version: '0.4.0', url: expect.stringContaining('v0.4.0') });
    checker.stop();
  });

  it('stays silent when the latest release is not newer', async () => {
    const onUpdateAvailable = vi.fn();
    const fetchFn = vi.fn(async () => release('v0.3.0'));
    const checker = startUpdateChecker({ currentVersion: '0.3.0', onUpdateAvailable, fetchFn, intervalMs: 60_000 });
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalled());
    expect(onUpdateAvailable).not.toHaveBeenCalled();
    expect(checker.getAvailable()).toBeNull();
    checker.stop();
  });

  it('re-checks on the interval but does not re-announce the same version', async () => {
    vi.useFakeTimers();
    const onUpdateAvailable = vi.fn();
    const fetchFn = vi.fn(async () => release('v0.4.0'));
    const checker = startUpdateChecker({ currentVersion: '0.3.0', onUpdateAvailable, fetchFn, intervalMs: 1_000 });
    await vi.advanceTimersByTimeAsync(3_500);
    expect(fetchFn.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(onUpdateAvailable).toHaveBeenCalledTimes(1);
    checker.stop();
  });

  it('does not announce when stop() is called while a check is in flight', async () => {
    let resolveFetch!: (r: Response) => void;
    const onUpdateAvailable = vi.fn();
    const fetchFn = vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve; }));
    const checker = startUpdateChecker({ currentVersion: '0.3.0', onUpdateAvailable, fetchFn, intervalMs: 60_000 });
    checker.stop();
    resolveFetch(release('v0.4.0'));
    await new Promise((r) => setTimeout(r, 0));
    expect(onUpdateAvailable).not.toHaveBeenCalled();
    expect(checker.getAvailable()).toBeNull();
  });
});
