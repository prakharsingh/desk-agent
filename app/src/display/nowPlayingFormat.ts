// No artist or track-position data exists on the wire (see widgetReaders.ts /
// design spec's honest-placeholder rule) -- these are the two sentinel
// values 'nowPlaying' can carry that mean "no track", vs. a real title.
export function hasActiveTrack(nowPlaying: string): boolean {
  return nowPlaying !== '—' && nowPlaying !== 'unavailable';
}

// Home dashboard's compact Now Playing tile: never surface the raw wire
// sentinel ('—' / 'unavailable') as the track label -- show the honest
// "Idle" state instead. Real track names pass through unchanged.
export function homeTrackLabel(nowPlaying: string): string {
  return hasActiveTrack(nowPlaying) ? nowPlaying : 'Idle';
}
