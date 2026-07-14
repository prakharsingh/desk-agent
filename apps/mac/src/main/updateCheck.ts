// Unsigned/ad-hoc apps can't use electron-updater on macOS, so update
// discovery is a read-only poll of the GitHub Releases API: surface "an
// update exists" in the tray and let the user download it themselves.
// Contract: never throws, never blocks app function -- offline is normal.

const LATEST_RELEASE_URL = 'https://api.github.com/repos/prakharsingh/desk-agent/releases/latest';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface ReleaseInfo {
  version: string; // no leading "v"
  url: string;
}

function parseParts(v: string): number[] {
  return v.replace(/^v/, '').split('.').map((n) => Number.parseInt(n, 10) || 0);
}

export function isNewerVersion(current: string, latest: string): boolean {
  const cur = parseParts(current);
  const lat = parseParts(latest);
  for (let i = 0; i < 3; i++) {
    if ((lat[i] ?? 0) > (cur[i] ?? 0)) return true;
    if ((lat[i] ?? 0) < (cur[i] ?? 0)) return false;
  }
  return false;
}

export async function fetchLatestRelease(fetchFn: typeof fetch = fetch): Promise<ReleaseInfo | null> {
  try {
    const res = await fetchFn(LATEST_RELEASE_URL, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { tag_name?: unknown; html_url?: unknown };
    if (typeof body.tag_name !== 'string' || typeof body.html_url !== 'string') return null;
    return { version: body.tag_name.replace(/^v/, ''), url: body.html_url };
  } catch {
    return null;
  }
}

export interface UpdateChecker {
  getAvailable(): ReleaseInfo | null;
  stop(): void;
}

export function startUpdateChecker(opts: {
  currentVersion: string;
  onUpdateAvailable: (info: ReleaseInfo) => void;
  fetchFn?: typeof fetch;
  intervalMs?: number;
}): UpdateChecker {
  let available: ReleaseInfo | null = null;
  let stopped = false;
  const check = async () => {
    const latest = await fetchLatestRelease(opts.fetchFn ?? fetch);
    // A check awaiting fetch when stop() lands must not resurrect the checker (announce into a torn-down tray).
    if (stopped) return;
    if (!latest || !isNewerVersion(opts.currentVersion, latest.version)) return;
    const alreadyAnnounced = available?.version === latest.version;
    available = latest;
    if (!alreadyAnnounced) opts.onUpdateAvailable(latest);
  };
  void check();
  const timer = setInterval(check, opts.intervalMs ?? CHECK_INTERVAL_MS);
  // Don't let a 24h timer keep the process alive during shutdown.
  timer.unref?.();
  return {
    getAvailable: () => available,
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
