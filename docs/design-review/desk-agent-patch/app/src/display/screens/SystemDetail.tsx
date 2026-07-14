import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme.js';
import type { SystemStatsView } from '../widgetReaders.js';
import { BackHeader } from '../ui/BackHeader.js';
import { StatBar } from '../ui/StatBar.js';
import { Sparkline } from '../ui/Sparkline.js';
import { pctOrZero, fmtPct, loadColor, formatBattery } from '../systemFormat.js';

export interface SystemDetailProps {
  stats: SystemStatsView;
  cpuHistory: number[];
  ramHistory: number[];
  onBack: () => void;
}

export function SystemDetail({ stats, cpuHistory, ramHistory, onBack }: SystemDetailProps) {
  // Amber when a metric is running hot, so a sustained ~99% RAM reads as an
  // intentional "high" state rather than the same neutral colour as idle.
  const cpuColor = loadColor(stats.cpuPercent, theme.colors.accent, theme.colors.warn);
  const ramColor = loadColor(stats.ramPercent, theme.colors.ram, theme.colors.warn);

  return (
    <View style={styles.screen}>
      <BackHeader title="SYSTEM" onBack={onBack} />
      <View style={styles.section}>
        <StatBar label="CPU" value={fmtPct(stats.cpuPercent)} pct={pctOrZero(stats.cpuPercent)} color={cpuColor} />
        <View style={styles.sparklineWrap}>
          <Sparkline history={cpuHistory} color={cpuColor} width={280} height={64} />
        </View>
      </View>
      <View style={styles.section}>
        <StatBar label="RAM" value={fmtPct(stats.ramPercent)} pct={pctOrZero(stats.ramPercent)} color={ramColor} />
        <View style={styles.sparklineWrap}>
          <Sparkline history={ramHistory} color={ramColor} width={280} height={64} />
        </View>
      </View>
      <View style={styles.batteryRow}>
        <Text style={styles.batteryLabel}>BATTERY</Text>
        <Text style={styles.batteryValue}>{formatBattery(stats.battery)}</Text>
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
  section: {
    gap: theme.spacing.md,
  },
  sparklineWrap: {
    alignItems: 'flex-start',
  },
  batteryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing.md,
  },
  batteryLabel: {
    fontSize: 12,
    letterSpacing: 1,
    color: theme.colors.textFaint,
    fontFamily: theme.font.regular,
  },
  batteryValue: {
    fontSize: 12,
    color: theme.colors.text,
    fontFamily: theme.font.regular,
  },
});
