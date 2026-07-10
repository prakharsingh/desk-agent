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
});
