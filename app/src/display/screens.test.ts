import { describe, it, expect } from 'vitest';
import { INITIAL_SCREEN_STATE, STANDBY_VOICE, STANDBY_DECK, goTo, goToStandby, back, sleep, wake } from './screens.js';

describe('screens reducer', () => {
  it('starts on home', () => {
    expect(INITIAL_SCREEN_STATE.screen).toBe('home');
  });

  it('goTo navigates to a detail screen', () => {
    expect(goTo(INITIAL_SCREEN_STATE, 'system').screen).toBe('system');
  });

  it('back always returns to home from any detail screen', () => {
    for (const s of ['system', 'weather', 'playing', 'presence', 'clock'] as const) {
      expect(back(goTo(INITIAL_SCREEN_STATE, s)).screen).toBe('home');
    }
  });

  it('back from home is a no-op (stays home)', () => {
    expect(back(INITIAL_SCREEN_STATE).screen).toBe('home');
  });

  it('goToStandby sets screen to standby and records the standby info', () => {
    const s = goToStandby(INITIAL_SCREEN_STATE, STANDBY_VOICE);
    expect(s.screen).toBe('standby');
    expect(s.standby).toEqual(STANDBY_VOICE);
  });

  it('STANDBY_DECK is distinct from STANDBY_VOICE', () => {
    expect(STANDBY_DECK.name).not.toBe(STANDBY_VOICE.name);
  });

  it('sleep moves to idle from any screen', () => {
    expect(sleep(goTo(INITIAL_SCREEN_STATE, 'system')).screen).toBe('idle');
  });

  it('wake moves to home from idle', () => {
    const idle = sleep(INITIAL_SCREEN_STATE);
    expect(wake(idle).screen).toBe('home');
  });

  it('goTo navigates to the settings screen', () => {
    expect(goTo(INITIAL_SCREEN_STATE, 'settings').screen).toBe('settings');
  });
});
