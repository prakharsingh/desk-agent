import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme.js';
import { formatClock, formatDate, formatUptime } from '../format.js';
import { BackHeader } from '../ui/BackHeader.js';

export interface ClockScreenProps {
  now: number;
  startedAt: number;
  onBack: () => void;
}

export function ClockScreen({ now, startedAt, onBack }: ClockScreenProps) {
  const { timeHHMM, timeSS } = formatClock(now);
  const dateStr = formatDate(now);
  const uptimeStr = formatUptime(startedAt, now);

  return (
    <View style={styles.screen}>
      <BackHeader title="CLOCK" onBack={onBack} />
      <View style={styles.body}>
        <View style={styles.timeRow}>
          <Text style={styles.time}>{timeHHMM}</Text>
          <Text style={styles.seconds}>{timeSS}</Text>
        </View>
        <Text style={styles.date}>{dateStr}</Text>
        <Text style={styles.uptime}>{'UP ' + uptimeStr}</Text>
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
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.md,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  time: {
    fontSize: 88,
    fontFamily: theme.font.bold,
    color: theme.colors.text,
  },
  seconds: {
    fontSize: 32,
    fontFamily: theme.font.bold,
    color: theme.colors.accent,
    marginLeft: theme.spacing.sm,
  },
  date: {
    fontSize: 14,
    letterSpacing: 2,
    color: theme.colors.textDim,
    fontFamily: theme.font.regular,
  },
  uptime: {
    fontSize: 11,
    letterSpacing: 2,
    color: theme.colors.textFaint,
    fontFamily: theme.font.regular,
  },
});
