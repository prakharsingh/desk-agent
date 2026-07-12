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
import { SectionIcon } from './ui/SectionIcon.js';
import { WeatherIcon } from './ui/WeatherIcon.js';

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

function pctOrZero(v: number | null): number {
  return typeof v === 'number' ? v : 0;
}

function fmtPct(v: number | null): string {
  return typeof v === 'number' ? `${Math.round(v)}%` : '—';
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

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* Clock hero card */}
      <Card onPress={onGoClock}>
        <View style={styles.cardHeaderRow}>
          <View style={styles.labelRow}>
            <SectionIcon kind="clock" />
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
      <Card onPress={onGoSystem}>
        <View style={styles.cardHeaderRow}>
          <View style={styles.labelRow}>
            <SectionIcon kind="system" />
            <Text style={styles.sectionLabelAccent}>SYSTEM</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </View>
        <View style={styles.systemColumns}>
          <View style={styles.systemColumn}>
            <StatBar label="CPU" value={fmtPct(stats.cpuPercent)} pct={pctOrZero(stats.cpuPercent)} color={theme.colors.accent} />
            <View style={styles.sparklineWrap}>
              <Sparkline history={cpuHistory} color={theme.colors.accent} width={120} height={28} />
            </View>
          </View>
          <View style={styles.systemColumn}>
            <StatBar label="RAM" value={fmtPct(stats.ramPercent)} pct={pctOrZero(stats.ramPercent)} color={theme.colors.ram} />
            <View style={styles.sparklineWrap}>
              <Sparkline history={ramHistory} color={theme.colors.ram} width={120} height={28} />
            </View>
          </View>
        </View>
        <View style={styles.batteryRow}>
          <Text style={styles.batteryLabel}>BATTERY</Text>
          <Text style={styles.batteryValue}>{stats.battery}</Text>
        </View>
      </Card>

      {/* Weather + Presence row */}
      <View style={styles.halfRow}>
        <Card onPress={onGoWeather} style={styles.halfCard}>
          <View style={styles.labelRow}>
            <WeatherIcon kind={iconKindForConditions(weather.conditions)} size={14} />
            <Text style={styles.sectionLabelAccent}>WEATHER</Text>
          </View>
          <Text style={styles.weatherTemp}>{typeof weather.tempF === 'number' ? formatTemp(weather.tempF, unit) : '—'}</Text>
          <Text style={styles.weatherConditions}>{weather.conditions}</Text>
          <Text style={[styles.weatherTag, { color: weather.stale ? theme.colors.warn : theme.colors.accent }]}>
            {weather.stale ? 'STALE' : 'LIVE'}
          </Text>
        </Card>
        <Card onPress={onGoPresence} style={styles.halfCard}>
          <View style={styles.labelRow}>
            <SectionIcon kind="presence" />
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
        <Card onPress={onGoPlaying} style={styles.halfCard}>
          <View style={styles.labelRow}>
            <SectionIcon kind="playing" />
            <Text style={styles.sectionLabelAccent}>NOW PLAYING</Text>
          </View>
          <View style={styles.playingRow}>
            <View style={styles.albumArt}>
              <Text style={styles.albumArtGlyph}>♪</Text>
            </View>
            <Text style={styles.trackName} numberOfLines={1}>
              {stats.nowPlaying}
            </Text>
          </View>
        </Card>
        <Card onPress={onGoLight} style={styles.halfCard}>
          <View style={styles.labelRow}>
            <SectionIcon kind="light" />
            <Text style={styles.sectionLabelAccent}>CHIN LIGHT</Text>
          </View>
        </Card>
      </View>

      {/* Voice + Steam Deck standby row */}
      <View style={styles.halfRow}>
        <Card onPress={onGoVoice} style={styles.halfCard}>
          <View style={styles.labelRow}>
            <SectionIcon kind="voice" />
            <Text style={styles.standbyLabel}>VOICE</Text>
          </View>
          <Text style={styles.roadmapBadge}>ROADMAP</Text>
          <Text style={styles.standbyCaption}>MODULE STANDBY</Text>
        </Card>
        <Card onPress={onGoDeck} style={styles.halfCard}>
          <View style={styles.labelRow}>
            <SectionIcon kind="deck" />
            <Text style={styles.standbyLabel}>STEAM DECK</Text>
          </View>
          <Text style={styles.roadmapBadge}>ROADMAP</Text>
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
  weatherTag: {
    fontSize: 9,
    letterSpacing: 1,
    marginTop: theme.spacing.sm,
    fontFamily: theme.font.medium,
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
    fontSize: 9,
    letterSpacing: 1,
    color: theme.colors.textFainter,
    marginTop: theme.spacing.sm,
    fontFamily: theme.font.medium,
  },
  standbyCaption: {
    fontSize: 10,
    color: theme.colors.textFaint,
    marginTop: theme.spacing.xs,
    fontFamily: theme.font.regular,
  },
});
