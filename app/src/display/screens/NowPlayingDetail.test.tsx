import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { NowPlayingDetail } from './NowPlayingDetail.js';
import type { SystemStatsView } from '../widgetReaders.js';

const NO_TRACK: SystemStatsView = {
  cpuPercent: null,
  ramPercent: null,
  battery: '—',
  nowPlaying: '—',
  nowPlayingIsPlaying: false,
  nowPlayingArtwork: null,
};

const PLAYING_TRACK: SystemStatsView = {
  ...NO_TRACK,
  nowPlaying: 'Comfortably Numb',
  nowPlayingIsPlaying: true,
};

const PAUSED_TRACK: SystemStatsView = {
  ...PLAYING_TRACK,
  nowPlayingIsPlaying: false,
};

describe('NowPlayingDetail', () => {
  it('hides the transport controls when there is no active track', async () => {
    await render(<NowPlayingDetail stats={NO_TRACK} onBack={() => {}} />);
    expect(screen.queryByText('⏯')).toBeNull();
    expect(screen.queryByText('▶')).toBeNull();
    expect(screen.queryByText('⏸')).toBeNull();
  });

  it('falls back to the music-note glyph when there is no active track', async () => {
    await render(<NowPlayingDetail stats={NO_TRACK} onBack={() => {}} />);
    expect(screen.getByText('♪')).toBeTruthy();
  });

  it('shows the transport controls and a pause glyph while a track is playing', async () => {
    await render(<NowPlayingDetail stats={PLAYING_TRACK} onBack={() => {}} />);
    expect(screen.getByText('⏸')).toBeTruthy();
    expect(screen.getByText('⏮')).toBeTruthy();
    expect(screen.getByText('⏭')).toBeTruthy();
  });

  it('shows a play glyph (not pause) when the active track is paused', async () => {
    await render(<NowPlayingDetail stats={PAUSED_TRACK} onBack={() => {}} />);
    expect(screen.getByText('▶')).toBeTruthy();
    expect(screen.queryByText('⏸')).toBeNull();
  });

  it('invokes onTogglePlayPause when the play/pause button is pressed', async () => {
    const onTogglePlayPause = jest.fn();
    await render(<NowPlayingDetail stats={PLAYING_TRACK} onBack={() => {}} onTogglePlayPause={onTogglePlayPause} />);
    await fireEvent.press(screen.getByText('⏸'));
    expect(onTogglePlayPause).toHaveBeenCalledTimes(1);
  });

  it('invokes onNext and onPrevious for the skip buttons', async () => {
    const onNext = jest.fn();
    const onPrevious = jest.fn();
    await render(<NowPlayingDetail stats={PLAYING_TRACK} onBack={() => {}} onNext={onNext} onPrevious={onPrevious} />);
    await fireEvent.press(screen.getByText('⏭'));
    await fireEvent.press(screen.getByText('⏮'));
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrevious).toHaveBeenCalledTimes(1);
  });

  it('always renders the em-dash placeholder for artist (no artist data on the wire)', async () => {
    await render(<NowPlayingDetail stats={PLAYING_TRACK} onBack={() => {}} />);
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('shows the honest composed empty state instead of the raw wire sentinel when idle', async () => {
    await render(<NowPlayingDetail stats={NO_TRACK} onBack={() => {}} />);
    expect(screen.getByText('NOTHING PLAYING')).toBeTruthy();
    expect(screen.getByText('Music.app · idle')).toBeTruthy();
  });

  it('never renders the raw "—" wire sentinel as a track name when idle', async () => {
    await render(<NowPlayingDetail stats={NO_TRACK} onBack={() => {}} />);
    expect(screen.queryByText('—')).toBeNull();
  });

  it('shows the same composed empty state for the "unavailable" TCC-denied sentinel', async () => {
    await render(<NowPlayingDetail stats={{ ...NO_TRACK, nowPlaying: 'unavailable' }} onBack={() => {}} />);
    expect(screen.getByText('NOTHING PLAYING')).toBeTruthy();
    expect(screen.queryByText('unavailable')).toBeNull();
  });
});
