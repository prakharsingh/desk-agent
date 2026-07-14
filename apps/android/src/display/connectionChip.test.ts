import { describe, it, expect } from 'vitest';
import { connectionChip } from './connectionChip.js';
import { theme } from './theme.js';

describe('connectionChip', () => {
  it('maps connected to a LIVE chip in the accent color', () => {
    expect(connectionChip('connected')).toEqual({ color: theme.colors.accent, label: 'LIVE' });
  });

  it('maps connecting to a dimmed CONNECTING chip', () => {
    expect(connectionChip('connecting')).toEqual({ color: theme.colors.textFaint, label: 'CONNECTING', dim: true });
  });

  it('maps tunnel-down to an alert LINK DOWN chip', () => {
    expect(connectionChip('tunnel-down')).toEqual({ color: theme.colors.alert, label: 'LINK DOWN' });
  });

  it('maps server-down to the same alert LINK DOWN chip as tunnel-down', () => {
    expect(connectionChip('server-down')).toEqual({ color: theme.colors.alert, label: 'LINK DOWN' });
  });

  it('falls back to an UNKNOWN chip for an unrecognized state', () => {
    // ConnectionState is a closed union today, but the mapping function's own
    // default branch is unreachable from valid TypeScript callers -- cast to
    // exercise it directly rather than leaving it silently untested.
    expect(connectionChip('bogus' as never)).toEqual({ color: theme.colors.textFaint, label: 'UNKNOWN' });
  });
});
