// No artist or track-position data exists on the wire (see widgetReaders.ts /
// design spec's honest-placeholder rule) -- these are the two sentinel
// values 'nowPlaying' can carry that mean "no track", vs. a real title.
export function hasActiveTrack(nowPlaying: string): boolean {
  return nowPlaying !== '—' && nowPlaying !== 'unavailable';
}
