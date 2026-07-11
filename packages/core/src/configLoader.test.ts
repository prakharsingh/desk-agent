import { describe, it, expect } from 'vitest';
import { loadConfig } from './index.js';

describe('loadConfig', () => {
  it('applies sane defaults when optional fields are omitted', () => {
    const config = loadConfig({ weather: { apiKey: 'k', location: 'Seattle' } });
    expect(config.enabledPlugins).toEqual(['system-stats', 'weather', 'energy-saver']);
    expect(config.presenceDebounceMs).toBe(30000);
    expect(config.wsPort).toBe(8787);
  });

  it('accepts fully specified config', () => {
    const config = loadConfig({
      enabledPlugins: ['weather'],
      weather: { apiKey: 'k', location: 'Seattle' },
      presenceDebounceMs: 5000,
      wsPort: 9000,
    });
    expect(config.enabledPlugins).toEqual(['weather']);
    expect(config.wsPort).toBe(9000);
  });

  it('throws with a descriptive message when weather config is missing', () => {
    expect(() => loadConfig({})).toThrow();
  });

  it('applies sane defaults for the presence block when omitted', () => {
    const config = loadConfig({ weather: { apiKey: 'k', location: 'Seattle' } });
    expect(config.presence).toEqual({
      absenceTimeoutMs: 300000,
      gazeIsKeepAwake: true,
      bootConfirmationTimeoutMs: 300000,
    });
  });

  it('accepts a fully specified presence block', () => {
    const config = loadConfig({
      weather: { apiKey: 'k', location: 'Seattle' },
      presence: { absenceTimeoutMs: 60000, gazeIsKeepAwake: false, bootConfirmationTimeoutMs: 60000 },
    });
    expect(config.presence.absenceTimeoutMs).toBe(60000);
    expect(config.presence.gazeIsKeepAwake).toBe(false);
  });
});
