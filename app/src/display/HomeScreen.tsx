import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { theme } from './theme.js';
import { formatClock, formatDate, formatUptime } from './format.js';
import { formatTemp, type TemperatureUnit } from './temperature.js';
import { iconKindForConditions } from './weatherIcon.js';
import type { SystemStatsView, WeatherView } from './widgetReaders.js';
import type { PresenceView } from './derivePresence.js';
import { Card } from './ui/Card.js';
import { StatBar } from './ui/StatBar.js';
import { Sparkline } from './ui/Sparkline.js';
import { IconChip } from './ui/IconChip.js';
import { Badge } from './ui/Badge.js';
import { WeatherIcon } from './ui/WeatherIcon.js';
import { pctOrZero, fmtPct, loadColor, formatBattery } from './systemFormat.js';
import { homeTrackLabel } from './nowPlayingFormat.js';

export interface HomeScreenProps {
  stats: SystemStatsView;
  weather: WeatherView;
  presence: PresenceView;
  now: number;
  startedAt: number;
  cpuHistory: number[];
  ramHistory: number[];
  // Owned by AppShell so the preference stays in sync with WeatherDetail's
  // toggle regardless of which screen last changed it.
  unit: TemperatureUnit;
  onGoSystem: () => void;
  onGoWeather: () => void;
  onGoPlaying: () => void;
  onGoPresence: () => void;
  onGoClock: () => void;
  onGoVoice: () => void;
  onGoDeck: () => void;
  onGoLight: () => void;
}

export function HomeScreen({
  stats,
  weather,
  presence,
  now,
  startedAt,
  cpuHistory,
  ramHistory,
  unit,
  onGoSystem,
  onGoWeather,
  onGoPlaying,
  onGoPresence,
  onGoClock,
  onGoVoice,
  onGoDeck,
  onGoLight,
}: HomeScreenProps) {
  const { timeHHMM, timeSS } = formatClock(now);
  const dateStr = formatDate(now);
  const uptimeStr = formatUptime(startedAt, now);

  // Amber when running hot so a sustained ~99% RAM reads as an intentional
  // "high" state rather than the same neutral colour as an idle metric.
  const cpuColor = loadColor(stats.cpuPercent, theme.colors.accent, theme.colors.warn);
  const ramColor = loadColor(stats.ramPercent, theme.colors.ram, theme.colors.warn);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* Clock hero card */}
      <Card onPress={onGoClock} accent>
        <View style={styles.cardHeaderRow}>
          <View style={styles.labelRow}>
            <IconChip kind="clock" />
            <Text style={styles.sectionLabelAccent}>CLOCK</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </View>
        <View style={styles.clockRow}>
          <Text style={styles.heroTime}>{timeHHMM}</Text>
          <Text style={styles.heroSeconds}>{timeSS}</Text>
        </View>
        <View style={styles.clockFooterRow}>
          <Text style={styles.clockFooterText}>{dateStr}</Text>
          <Text style={styles.clockFooterText}>{'UP ' + uptimeStr}</Text>
        </View>
      </Card>

      {/* System card */}
      <Card onPress={onGoSystem} accent>
        <View style={styles.cardHeaderRow}>
          <View style={styles.labelRow}>
            <IconChip kind="system" />
            <Text style={styles.sectionLabelAccent}>SYSTEM</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </View>
        <View style={styles.systemColumns}>
          <View style={styles.systemColumn}>
            <StatBar label="CPU" value={fmtPct(stats.cpuPercent)} pct={pctOrZero(stats.cpuPercent)} color={cpuColor} />
            <View style={styles.sparklineWrap}>
              <Sparkline history={cpuHistory} color={cpuColor} width={120} height={28} />
            </View>
          </View>
          <View style={styles.systemColumn}>
            <StatBar label="RAM" value={fmtPct(stats.ramPercent)} pct={pctOrZero(stats.ramPercent)} color={ramColor} />
            <View style={styles.sparklineWrap}>
              <Sparkline history={ramHistory} color={ramColor} width={120} height={28} />
            </View>
          </View>
        </View>
        <View style={styles.batteryRow}>
          <Text style={styles.batteryLabel}>BATTERY</Text>
          <Text style={styles.batteryValue}>{formatBattery(stats.battery)}</Text>
        </View>
      </Card>

      {/* Weather + Presence row */}
      <View style={styles.halfRow}>
        <Card onPress={onGoWeather} accent style={styles.halfCard}>
          <View style={styles.labelRow}>
            <WeatherIcon kind={iconKindForConditions(weather.conditions)} size={14} />
            <Text style={styles.sectionLabelAccent}>WEATHER</Text>
          </View>
          <Text style={styles.weatherTemp}>{typeof weather.tempF === 'number' ? formatTemp(weather.tempF, unit) : '—'}</Text>
          <Text style={styles.weatherConditions}>{weather.conditions}</Text>
          <Badge label={weather.stale ? 'STALE' : 'LIVE'} tone={weather.stale ? 'stale' : 'live'} style={styles.weatherBadge} />
        </Card>
        <Card onPress={onGoPresence} accent style={styles.halfCard}>
          <View style={styles.labelRow}>
            <IconChip kind="presence" />
            <Text style={styles.sectionLabelFaint}>PRESENCE</Text>
          </View>
          <View style={styles.presenceRow}>
            <View style={[styles.presenceDot, { backgroundColor: presence.color }]} />
            <Text style={[styles.presenceLabel, { color: presence.color }]}>{presence.label}</Text>
          </View>
        </Card>
      </View>

      {/* Now Playing + Chin Light row */}
      {/* No track-position data exists on the wire (see NowPlayingDetail.tsx /
          design spec's honest-placeholder rule) -- omit the progress readout
          entirely rather than showing a fabricated 0% bar. */}
      <View style={styles.halfRow}>
        <Card onPress={onGoPlaying} accent style={styles.halfCard}>
          <View style={styles.labelRow}>
            <IconChip kind="playing" />
            <Text style={styles.sectionLabelAccent}>NOW PLAYING</Text>
          </View>
          <View style={styles.playingRow}>
            <View style={styles.albumArt}>
              <Text style={styles.albumArtGlyph}>♪</Text>
            </View>
            <Text style={styles.trackName} numberOfLines={1}>
              {homeTrackLabel(stats.nowPlaying)}
            </Text>
          </View>
        </Card>
        <Card onPress={onGoLight} accent style={styles.halfCard}>
          <View style={styles.labelRow}>
            <IconChip kind="light" />
            <Text style={styles.sectionLabelAccent}>CHIN LIGHT</Text>
          </View>
        </Card>
      </View>

      {/* Voice + Steam Deck standby row -- roadmap variant: dashed, dimmed,
          honest ROADMAP / MODULE STANDBY / NOT LINKED copy, never a
          fabricated feature description. */}
      <View style={styles.halfRow}>
        <Card onPress={onGoVoice} variant="roadmap" style={styles.halfCard}>
          <View style={styles.labelRow}>
            <IconChip kind="voice" tone="dim" />
            <Text style={styles.standbyLabel}>VOICE</Text>
          </View>
          <Badge label="ROADMAP" tone="neutral" style={styles.roadmapBadge} />
          <Text style={styles.standbyCaption}>MODULE STANDBY</Text>
        </Card>
        <Card onPress={onGoDeck} variant="roadmap" style={styles.halfCard}>
          <View style={styles.labelRow}>
            <IconChip kind="deck" tone="dim" />
            <Text style={styles.standbyLabel}>STEAM DECK</Text>
          </View>
          <Badge label="ROADMAP" tone="neutral" style={styles.roadmapBadge} />
          <Text style={styles.standbyCaption}>NOT LINKED</Text>
        </Card>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.bg,
  },
  content: {
    padding: theme.spacing.lg,
    gap: theme.spacing.lg,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  sectionLabelAccent: {
    fontSize: 11,
    letterSpacing: 2,
    color: theme.colors.accent,
    fontFamily: theme.font.regular,
  },
  sectionLabelFaint: {
    fontSize: 11,
    letterSpacing: 2,
    color: theme.colors.textFaint,
    fontFamily: theme.font.regular,
  },
  chevron: {
    fontSize: 16,
    color: theme.colors.textFainter,
  },
  clockRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    marginVertical: theme.spacing.lg,
  },
  heroTime: {
    fontSize: 66,
    fontFamily: theme.font.bold,
    color: theme.colors.text,
  },
  heroSeconds: {
    fontSize: 24,
    fontFamily: theme.font.bold,
    color: theme.colors.accent,
    marginLeft: theme.spacing.xs,
  },
  clockFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing.sm,
  },
  clockFooterText: {
    fontSize: 9,
    letterSpacing: 2,
    color: theme.colors.textFaint,
    fontFamily: theme.font.regular,
  },
  systemColumns: {
    flexDirection: 'row',
    gap: theme.spacing.lg,
    marginTop: theme.spacing.md,
  },
  systemColumn: {
    flex: 1,
    gap: theme.spacing.sm,
  },
  sparklineWrap: {
    alignItems: 'flex-start',
  },
  batteryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    marginTop: theme.spacing.md,
    paddingTop: theme.spacing.sm,
  },
  batteryLabel: {
    fontSize: 11,
    letterSpacing: 1,
    color: theme.colors.textFaint,
    fontFamily: theme.font.regular,
  },
  batteryValue: {
    fontSize: 11,
    color: theme.colors.text,
    fontFamily: theme.font.regular,
  },
  halfRow: {
    flexDirection: 'row',
    gap: theme.spacing.lg,
  },
  halfCard: {
    flex: 1,
  },
  weatherTemp: {
    fontSize: 32,
    fontFamily: theme.font.bold,
    color: theme.colors.text,
    marginTop: theme.spacing.sm,
  },
  weatherConditions: {
    fontSize: 12,
    color: theme.colors.textDim,
    fontFamily: theme.font.regular,
  },
  weatherBadge: {
    marginTop: theme.spacing.sm,
  },
  presenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  presenceDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  presenceLabel: {
    fontSize: 16,
    fontFamily: theme.font.semibold,
  },
  playingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    marginTop: theme.spacing.md,
  },
  albumArt: {
    width: 40,
    height: 40,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  albumArtGlyph: {
    color: theme.colors.textFaint,
    fontSize: 16,
  },
  trackName: {
    flex: 1,
    fontSize: 13,
    color: theme.colors.text,
    fontFamily: theme.font.regular,
  },
  standbyLabel: {
    fontSize: 11,
    letterSpacing: 1,
    color: theme.colors.textFaint,
    fontFamily: theme.font.regular,
  },
  roadmapBadge: {
    marginTop: theme.spacing.sm,
  },
  standbyCaption: {
    fontSize: 10,
    color: theme.colors.textFaint,
    marginTop: theme.spacing.xs,
    fontFamily: theme.font.regular,
  },
});
