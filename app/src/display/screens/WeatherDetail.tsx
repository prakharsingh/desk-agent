import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme.js';
import { formatForecastDay } from '../format.js';
import { formatTemp, type TemperatureUnit } from '../temperature.js';
import { iconKindForConditions } from '../weatherIcon.js';
import type { WeatherView } from '../widgetReaders.js';
import { BackHeader } from '../ui/BackHeader.js';
import { Toggle } from '../ui/Toggle.js';
import { WeatherIcon } from '../ui/WeatherIcon.js';

export interface WeatherDetailProps {
  weather: WeatherView;
  onBack: () => void;
  // Owned by AppShell (not local state here) so the preference survives
  // navigating away from and back to this screen.
  unit: TemperatureUnit;
  onToggleUnit: () => void;
}

export function WeatherDetail({ weather, onBack, unit, onToggleUnit }: WeatherDetailProps) {
  const isCelsius = unit === 'C';
  return (
    <View style={styles.screen}>
      <BackHeader title="WEATHER" onBack={onBack} />
      <View style={styles.body}>
        <WeatherIcon kind={iconKindForConditions(weather.conditions)} size={40} />
        <Text style={styles.temp}>{typeof weather.tempF === 'number' ? formatTemp(weather.tempF, unit) : '—'}</Text>
        <Text style={styles.conditions}>{weather.conditions}</Text>
        <Text style={[styles.tag, { color: weather.stale ? theme.colors.warn : theme.colors.accent }]}>
          {weather.stale ? 'STALE' : 'LIVE'}
        </Text>
      </View>
      <View style={styles.unitRow}>
        <Text style={[styles.unitLabel, !isCelsius && styles.unitLabelActive]}>°F</Text>
        <Toggle on={isCelsius} onToggle={onToggleUnit} />
        <Text style={[styles.unitLabel, isCelsius && styles.unitLabelActive]}>°C</Text>
      </View>
      {weather.forecast.length > 0 && (
        <View style={styles.forecast}>
          {weather.forecast.map((day) => (
            <View key={day.date} style={styles.forecastRow}>
              <Text style={styles.forecastDay}>{formatForecastDay(day.date)}</Text>
              <WeatherIcon kind={iconKindForConditions(day.conditions)} />
              <Text style={styles.forecastConditions}>{day.conditions}</Text>
              <Text style={styles.forecastHi}>{formatTemp(day.tempMaxF, unit)}</Text>
              <Text style={styles.forecastLo}>{formatTemp(day.tempMinF, unit)}</Text>
            </View>
          ))}
        </View>
      )}
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
  temp: {
    fontSize: 72,
    fontFamily: theme.font.bold,
    color: theme.colors.text,
  },
  conditions: {
    fontSize: 16,
    color: theme.colors.textDim,
    fontFamily: theme.font.regular,
  },
  tag: {
    fontSize: 11,
    letterSpacing: 1,
    marginTop: theme.spacing.md,
    fontFamily: theme.font.medium,
  },
  forecast: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing.md,
  },
  forecastRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderDim,
  },
  forecastDay: {
    width: 40,
    fontSize: 12,
    letterSpacing: 1,
    color: theme.colors.textDim,
    fontFamily: theme.font.medium,
  },
  forecastConditions: {
    flex: 1,
    fontSize: 12,
    marginLeft: theme.spacing.sm,
    color: theme.colors.textFaint,
    fontFamily: theme.font.regular,
  },
  unitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
  },
  unitLabel: {
    fontSize: 12,
    letterSpacing: 1,
    color: theme.colors.textFainter,
    fontFamily: theme.font.medium,
  },
  unitLabelActive: {
    color: theme.colors.text,
  },
  forecastHi: {
    width: 44,
    textAlign: 'right',
    fontSize: 14,
    color: theme.colors.text,
    fontFamily: theme.font.medium,
  },
  forecastLo: {
    width: 44,
    textAlign: 'right',
    fontSize: 14,
    color: theme.colors.textFaint,
    fontFamily: theme.font.regular,
  },
});
