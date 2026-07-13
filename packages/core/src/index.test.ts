import { describe, it, expect } from 'vitest';
import * as core from './index.js';

describe('index public API', () => {
  it('exports run() so hosts (e.g. an Electron UtilityProcess) can start the core without a deep import into dist/main.js', () => {
    expect(typeof core.run).toBe('function');
  });

  it('run() is actually wired to config loading, not a no-op re-export: throws synchronously with a clear error for a missing config path', () => {
    const original = process.env.DESK_AGENT_CONFIG_PATH;
    process.env.DESK_AGENT_CONFIG_PATH = '/nonexistent/desk-agent-index-test/config.json';
    try {
      expect(() => core.run()).toThrow(/config not found/);
    } finally {
      if (original === undefined) delete process.env.DESK_AGENT_CONFIG_PATH;
      else process.env.DESK_AGENT_CONFIG_PATH = original;
    }
  });
});
