export type Screen = 'idle' | 'home' | 'system' | 'weather' | 'playing' | 'presence' | 'clock' | 'standby' | 'light';

export interface StandbyInfo {
  name: string;
  glyph: string;
  desc: string;
}

export interface ScreenState {
  screen: Screen;
  standby: StandbyInfo | null;
}

export const INITIAL_SCREEN_STATE: ScreenState = { screen: 'home', standby: null };

export const STANDBY_VOICE: StandbyInfo = {
  name: 'VOICE',
  glyph: '◍',
  desc: 'A push-to-talk assistant surface that speaks to the Mac brain over the same honest link. Wake word, on-device VAD, and a scrolling transcript are scoped but not yet wired.',
};

export const STANDBY_DECK: StandbyInfo = {
  name: 'STEAM DECK',
  glyph: '▣',
  desc: 'A companion tile mirroring the docked Steam Deck: battery, current game, and download queue — surfaced here so the desk shows one honest status at a glance.',
};

export function goTo(state: ScreenState, screen: Exclude<Screen, 'standby'>): ScreenState {
  return { screen, standby: null };
}

export function goToStandby(state: ScreenState, info: StandbyInfo): ScreenState {
  return { screen: 'standby', standby: info };
}

export function back(state: ScreenState): ScreenState {
  if (state.screen === 'idle') return state;
  return INITIAL_SCREEN_STATE;
}

export function sleep(state: ScreenState): ScreenState {
  return { screen: 'idle', standby: null };
}

export function wake(state: ScreenState): ScreenState {
  return INITIAL_SCREEN_STATE;
}
