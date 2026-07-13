import { describe, it, expect } from 'vitest';
import { parseConfig, ConfigSchema } from './index.js';

describe('ConfigSchema', () => {
  it('parses a fully empty object into a fully-defaulted, valid config (needed for first-run bootstrap)', () => {
    const config = parseConfig({});
    expect(config.enabledPlugins).toEqual(['system-stats', 'weather', 'energy-saver']);
    expect(config.weather.location).toBe('Seattle');
    expect(config.wsPort).toBe(8787);
    expect(config.presenceDebounceMs).toBe(30000);
    expect(config.watchdogTimeoutMs).toBe(30000);
  });

  it('defaults weather.location when the weather block is present but empty -- disabling the weather plugin should not require also specifying a location', () => {
    const config = parseConfig({ weather: {} });
    expect(config.weather.location).toBe('Seattle');
  });

  it('accepts a pre-existing on-disk config shape (weather.location only, no new fields) unchanged', () => {
    const config = parseConfig({ weather: { location: 'Portland' } });
    expect(config.weather.location).toBe('Portland');
    expect(config.weather.intervalMs).toBe(600_000);
  });

  it('rejects unknown-shaped input that cannot be coerced (e.g. wsPort as a string)', () => {
    expect(() => parseConfig({ wsPort: 'not-a-number' })).toThrow();
  });

  it('applies sane defaults for the presence block when omitted', () => {
    const config = parseConfig({});
    expect(config.presence).toEqual({
      absenceTimeoutMs: 300000,
      gazeIsKeepAwake: true,
      bootConfirmationTimeoutMs: 300000,
      wakeEnabled: true,
    });
  });

  it('ConfigSchema is exported directly for callers that need Zod-level access (e.g. renderer form validation)', () => {
    expect(ConfigSchema.safeParse({}).success).toBe(true);
  });

  it('defaults visibleWidgets to every known widget id, sourced from @desk-agent/protocol\'s WIDGET_IDS', () => {
    const config = parseConfig({});
    expect(config.visibleWidgets).toEqual(['clock', 'system', 'weather', 'presence', 'playing', 'light']);
  });

  it('accepts an explicit, narrower visibleWidgets list', () => {
    const config = parseConfig({ weather: {}, visibleWidgets: ['clock', 'weather'] });
    expect(config.visibleWidgets).toEqual(['clock', 'weather']);
  });

  // watchdogTimeoutMs used to be an unconfigurable, hardcoded safety constant
  // (main.ts's old WATCHDOG_TIMEOUT_MS). Now that it's config-writable, an
  // out-of-range value can defeat the safety property it exists for: too low
  // fires false "link dead" errors continuously (setTimeout clamps
  // zero/negative delays to ~1ms, so it never meaningfully waits); too high
  // silently disables the watchdog altogether, re-creating the exact
  // "silently-killed phone causes a false-absent sleep" failure it was added
  // to prevent.
  describe('watchdogTimeoutMs bounds', () => {
    it('rejects zero and negative values, which would fire the watchdog immediately/continuously', () => {
      expect(() => parseConfig({ weather: {}, watchdogTimeoutMs: 0 })).toThrow();
      expect(() => parseConfig({ weather: {}, watchdogTimeoutMs: -1 })).toThrow();
    });

    it('rejects a value below the heartbeat cadence, which would never leave a real margin against a live link', () => {
      // wsGateway broadcasts a heartbeat every 5000ms; a watchdog timeout at
      // or below that gives zero margin for normal jitter.
      expect(() => parseConfig({ weather: {}, watchdogTimeoutMs: 5000 })).toThrow();
    });

    it('rejects an unreasonably large value, which would silently disable the safety net', () => {
      expect(() => parseConfig({ weather: {}, watchdogTimeoutMs: Number.MAX_SAFE_INTEGER })).toThrow();
    });

    it('accepts the default 30000 and other sane in-range values', () => {
      expect(parseConfig({}).watchdogTimeoutMs).toBe(30000);
      expect(parseConfig({ weather: {}, watchdogTimeoutMs: 60000 }).watchdogTimeoutMs).toBe(60000);
    });
  });
});
