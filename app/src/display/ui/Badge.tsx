import React from 'react';
import { View, Text, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { theme } from '../theme.js';

export type BadgeTone = 'live' | 'stale' | 'warn' | 'neutral';

// Small uppercase status pill -- LIVE/STALE data tags, and COMING SOON /
// NOT LINKED / ROADMAP badges on not-yet-connected modules. One component
// replaces the ad-hoc per-screen badge styles so tone reads consistently
// everywhere it appears.
export function Badge({ label, tone, style }: { label: string; tone: BadgeTone; style?: StyleProp<ViewStyle> }) {
  const { color, backgroundColor, borderColor } = toneStyle(tone);
  return (
    <View style={[styles.pill, { backgroundColor, borderColor }, style]}>
      <Text style={[styles.label, { color }]}>{label}</Text>
    </View>
  );
}

function toneStyle(tone: BadgeTone): { color: string; backgroundColor: string; borderColor: string } {
  switch (tone) {
    case 'live':
      return { color: theme.colors.accent, backgroundColor: theme.colors.accentBg, borderColor: theme.colors.accentBorder };
    case 'stale':
    case 'warn':
      return { color: theme.colors.warn, backgroundColor: theme.colors.warnBg, borderColor: theme.colors.warnBorder };
    case 'neutral':
      return { color: theme.colors.textFaint, backgroundColor: 'transparent', borderColor: theme.colors.border };
  }
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: theme.radii.pill,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
  },
  label: {
    fontSize: 10,
    letterSpacing: 1,
    fontFamily: theme.font.medium,
  },
});
