import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme.js';
import type { SystemStatsView } from '../widgetReaders.js';
import { BackHeader } from '../ui/BackHeader.js';
import { Card } from '../ui/Card.js';
import { AreaChart } from '../ui/AreaChart.js';
import { fmtPct, loadColor, formatBattery } from '../systemFormat.js';
import { windowStats, type WindowStats } from '../windowStats.js';

export interface SystemDetailProps {
  stats: SystemStatsView;
  cpuHistory: number[];
  ramHistory: number[];
  onBack: () => void;
}

const CHART_WIDTH = 280;
const CHART_HEIGHT = 96;

export function SystemDetail({ stats, cpuHistory, ramHistory, onBack }: SystemDetailProps) {
  const cpuColor = loadColor(stats.cpuPercent, theme.colors.accent, theme.colors.warn);
  const ramColor = loadColor(stats.ramPercent, theme.colors.ram, theme.colors.warn);

  return (
    <View style={styles.screen}>
      <BackHeader title="SYSTEM" onBack={onBack} />
      <MetricCard label="CPU" value={fmtPct(stats.cpuPercent)} color={cpuColor} history={cpuHistory} />
      <MetricCard label="RAM" value={fmtPct(stats.ramPercent)} color={ramColor} history={ramHistory} />
      <View style={styles.batteryRow}>
        <Text style={styles.batteryLabel}>BATTERY</Text>
        <Text style={styles.batteryValue}>{formatBattery(stats.battery)}</Text>
      </View>
    </View>
  );
}

// One CPU/RAM section: label + live value, the axis-labeled AreaChart over
// the live rolling window, and a MIN/AVG/PEAK footer computed ONLY over that
// same window -- never a persisted time range, which this app doesn't keep.
// The "LIVE WINDOW" caption says so explicitly rather than implying "24H".
function MetricCard({ label, value, color, history }: { label: string; value: string; color: string; history: number[] }) {
  const stats: WindowStats = windowStats(history);

  return (
    <Card accent={color} style={styles.metricCard}>
      <View style={styles.metricHeaderRow}>
        <View>
          <Text style={styles.metricLabel}>{label}</Text>
          <Text style={styles.metricCaption}>LIVE WINDOW</Text>
        </View>
        <Text style={[styles.metricValue, { color }]}>{value}</Text>
      </View>
      <AreaChart history={history} color={color} width={CHART_WIDTH} height={CHART_HEIGHT} />
      <View style={styles.footRow}>
        <FootStat label="MIN" value={fmtPct(stats.min)} />
        <FootStat label="AVG" value={fmtPct(stats.avg)} />
        <FootStat label="PEAK" value={fmtPct(stats.peak)} />
      </View>
    </Card>
  );
}

function FootStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.footCell}>
      <Text style={styles.footLabel}>{label}</Text>
      <Text style={styles.footValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.bg,
    padding: theme.spacing.lg,
    gap: theme.spacing.lg,
  },
  metricCard: {
    gap: theme.spacing.md,
  },
  metricHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  metricLabel: {
    fontSize: 12,
    letterSpacing: 1,
    color: theme.colors.textFaint,
    fontFamily: theme.font.regular,
  },
  metricCaption: {
    fontSize: 9,
    letterSpacing: 1,
    color: theme.colors.textFainter,
    fontFamily: theme.font.regular,
    marginTop: 2,
  },
  metricValue: {
    fontSize: 22,
    fontFamily: theme.font.semibold,
  },
  footRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing.sm,
  },
  footCell: {
    gap: 2,
  },
  footLabel: {
    fontSize: 10,
    letterSpacing: 1,
    color: theme.colors.textFainter,
    fontFamily: theme.font.regular,
  },
  footValue: {
    fontSize: 13,
    color: theme.colors.textDim,
    fontFamily: theme.font.medium,
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
