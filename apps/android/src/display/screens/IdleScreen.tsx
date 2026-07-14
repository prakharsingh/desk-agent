import React from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { theme } from '../theme.js';
import { formatClock, formatDate, formatAway } from '../format.js';

export interface IdleScreenProps {
  now: number;
  awayMs: number;
  onWake: () => void;
}

// Ambient / asleep view -- deliberately NOT wrapped in BackHeader (no chrome,
// full-bleed, tap-anywhere-to-wake) and deliberately muted/dim relative to
// ClockScreen so it reads as "asleep" rather than as a second awake clock.
export function IdleScreen({ now, awayMs, onWake }: IdleScreenProps) {
  const { timeHHMM } = formatClock(now);
  const dateStr = formatDate(now);

  return (
    <Pressable style={styles.screen} onPress={onWake} onTouchStart={onWake}>
      <Text style={styles.time}>{timeHHMM}</Text>
      <Text style={styles.date}>{dateStr}</Text>
      <Text style={styles.caption}>{`DISPLAY ASLEEP · ${formatAway(awayMs)}`}</Text>
      <Text style={styles.caption}>PIXEL-SHIFT ACTIVE · TAP TO WAKE</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
  },
  time: {
    fontSize: 72,
    fontFamily: theme.font.regular,
    color: theme.colors.textFainter,
  },
  date: {
    fontSize: 12,
    letterSpacing: 2,
    color: theme.colors.textFainter,
    fontFamily: theme.font.regular,
  },
  caption: {
    fontSize: 10,
    letterSpacing: 1,
    color: theme.colors.textFainter,
    fontFamily: theme.font.regular,
    marginTop: theme.spacing.md,
  },
});
