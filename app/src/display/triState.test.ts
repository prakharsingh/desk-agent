import { describe, it, expect } from 'vitest';
import { fmtTri, fmtCameraState } from './triState.js';
import { theme } from './theme.js';

describe('fmtTri', () => {
  it('renders true as TRUE in the accent color', () => {
    expect(fmtTri(true)).toEqual({ text: 'TRUE', color: theme.colors.accent });
  });

  it('renders false as FALSE in a faint color', () => {
    expect(fmtTri(false)).toEqual({ text: 'FALSE', color: theme.colors.textFaint });
  });

  it('renders null as UNKNOWN in a faint color', () => {
    expect(fmtTri(null)).toEqual({ text: 'UNKNOWN', color: theme.colors.textFaint });
  });
});

describe('fmtCameraState', () => {
  it('renders active in the accent color', () => {
    expect(fmtCameraState('active')).toEqual({ text: 'ACTIVE', color: theme.colors.accent });
  });

  it('renders released in a faint color', () => {
    expect(fmtCameraState('released')).toEqual({ text: 'RELEASED', color: theme.colors.textFaint });
  });

  it('renders error in the alert color', () => {
    expect(fmtCameraState('error')).toEqual({ text: 'ERROR', color: theme.colors.alert });
  });

  it('falls back to UNKNOWN for any other state', () => {
    expect(fmtCameraState(null)).toEqual({ text: 'UNKNOWN', color: theme.colors.textFaint });
  });
});
