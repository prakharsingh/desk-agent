import React from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { theme } from '../theme.js';
import type { SystemStatsView } from '../widgetReaders.js';
import { BackHeader } from '../ui/BackHeader.js';
import { hasActiveTrack } from '../nowPlayingFormat.js';

export interface NowPlayingDetailProps {
  stats: SystemStatsView;
  onBack: () => void;
  onTogglePlayPause?: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
}

// No artist or track-position data exists on the wire (see widgetReaders.ts /
// design spec's honest-placeholder rule) -- artist is always rendered as '—'
// and no elapsed/duration readout is shown.
export function NowPlayingDetail({ stats, onBack, onTogglePlayPause, onNext, onPrevious }: NowPlayingDetailProps) {
  const hasTrack = hasActiveTrack(stats.nowPlaying);

  return (
    <View style={styles.screen}>
      <BackHeader title="NOW PLAYING" onBack={onBack} />
      <View style={styles.body}>
        <View style={styles.albumArt}>
          {hasTrack && stats.nowPlayingArtwork ? (
            <Image source={{ uri: stats.nowPlayingArtwork }} style={styles.albumArtImage} />
          ) : (
            <Text style={styles.albumArtGlyph}>♪</Text>
          )}
        </View>
        <Text style={styles.trackName}>{stats.nowPlaying}</Text>
        <Text style={styles.artist}>{'—'}</Text>
        {hasTrack && (
          <View style={styles.controls}>
            <Pressable style={styles.controlButton} onPress={onPrevious}>
              <Text style={styles.controlGlyph}>⏮</Text>
            </Pressable>
            <Pressable style={styles.controlButton} onPress={onTogglePlayPause}>
              <Text style={styles.controlGlyph}>{stats.nowPlayingIsPlaying ? '⏸' : '▶'}</Text>
            </Pressable>
            <Pressable style={styles.controlButton} onPress={onNext}>
              <Text style={styles.controlGlyph}>⏭</Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.bg,
    padding: theme.spacing.lg,
    gap: theme.spacing.xl,
  },
  body: {
    alignItems: 'center',
    marginTop: theme.spacing.xl,
    gap: theme.spacing.sm,
  },
  albumArt: {
    width: 96,
    height: 96,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.md,
    overflow: 'hidden',
  },
  albumArtImage: {
    width: '100%',
    height: '100%',
  },
  albumArtGlyph: {
    color: theme.colors.textFaint,
    fontSize: 32,
  },
  controls: {
    flexDirection: 'row',
    gap: theme.spacing.lg,
    marginTop: theme.spacing.md,
  },
  controlButton: {
    width: 48,
    height: 48,
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlGlyph: {
    color: theme.colors.text,
    fontSize: 18,
  },
  trackName: {
    fontSize: 18,
    color: theme.colors.text,
    fontFamily: theme.font.medium,
    textAlign: 'center',
  },
  artist: {
    fontSize: 13,
    color: theme.colors.textFaint,
    fontFamily: theme.font.regular,
  },
});
