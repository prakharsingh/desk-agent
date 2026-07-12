import { describe, it, expect } from 'vitest';
import { hasActiveTrack } from './nowPlayingFormat.js';

describe('hasActiveTrack', () => {
  it('is true for a real track name', () => {
    expect(hasActiveTrack('Comfortably Numb')).toBe(true);
  });

  it('is false for the no-data em-dash placeholder', () => {
    expect(hasActiveTrack('—')).toBe(false);
  });

  it('is false for the TCC-denied "unavailable" placeholder', () => {
    expect(hasActiveTrack('unavailable')).toBe(false);
  });

  // Documents current behavior rather than asserting it's ideal: an empty
  // string isn't one of the two known wire-level placeholder sentinels
  // ('—' / 'unavailable'), so it's treated as an active track today. Locked
  // in here so a future change to this is a deliberate, visible diff instead
  // of a silent behavior change.
  it('treats an empty string as an active track, matching current behavior', () => {
    expect(hasActiveTrack('')).toBe(true);
  });
});
