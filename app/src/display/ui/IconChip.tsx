import React from 'react';
import { View, StyleSheet } from 'react-native';
import { theme } from '../theme.js';
import { SectionIcon, type SectionIconKind } from './SectionIcon.js';

// Rounded accent-tinted chip that frames a section glyph in card headers.
// `tone="dim"` is for roadmap/disabled cards (Voice, Steam Deck) -- it fades
// both the chip surface and the glyph itself rather than just the container,
// so a "not linked yet" module reads as visually de-emphasized throughout.
export function IconChip({
  kind,
  size = 32,
  tone = 'accent',
}: {
  kind: SectionIconKind;
  size?: number;
  tone?: 'accent' | 'dim';
}) {
  const isDim = tone === 'dim';
  return (
    <View
      style={[
        styles.chip,
        { width: size, height: size, backgroundColor: isDim ? theme.colors.chipBgDim : theme.colors.chipBg },
      ]}
    >
      <SectionIcon kind={kind} size={size * 0.44} color={isDim ? theme.colors.textFainter : undefined} />
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: theme.radii.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
