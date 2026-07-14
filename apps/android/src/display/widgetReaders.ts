import type { Widget } from '@desk-agent/protocol';
import { resolveWidgetKind } from '../widgets/renderWidget.js';

export interface SystemStatsView {
  cpuPercent: number | null;
  ramPercent: number | null;
  battery: string;
  nowPlaying: string;
  nowPlayingIsPlaying: boolean;
  nowPlayingArtwork: string | null;
}

export interface DailyForecastView {
  date: string;
  tempMaxF: number;
  tempMinF: number;
  conditions: string;
}

export interface WeatherView {
  tempF: number | null;
  conditions: string;
  stale: boolean;
  forecast: DailyForecastView[];
}

function findWidget(widgets: Record<string, Widget>, kind: string): Widget | undefined {
  return Object.values(widgets).find((w) => resolveWidgetKind(w) === kind);
}

function readForecastEntry(raw: unknown): DailyForecastView | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.date !== 'string' || typeof r.tempMaxF !== 'number' || typeof r.tempMinF !== 'number' || typeof r.conditions !== 'string') {
    return null;
  }
  return { date: r.date, tempMaxF: r.tempMaxF, tempMinF: r.tempMinF, conditions: r.conditions };
}

export function readSystemStats(widgets: Record<string, Widget>): SystemStatsView {
  const w = findWidget(widgets, 'system-stats');
  const props = (w?.props ?? {}) as Record<string, unknown>;
  return {
    cpuPercent: typeof props.cpuPercent === 'number' ? props.cpuPercent : null,
    ramPercent: typeof props.ramPercent === 'number' ? props.ramPercent : null,
    battery: typeof props.battery === 'string' ? props.battery : '—',
    nowPlaying: typeof props.nowPlaying === 'string' ? props.nowPlaying : '—',
    nowPlayingIsPlaying: props.nowPlayingIsPlaying === true,
    nowPlayingArtwork: typeof props.nowPlayingArtwork === 'string' ? props.nowPlayingArtwork : null,
  };
}

export function readWeather(widgets: Record<string, Widget>): WeatherView {
  const w = findWidget(widgets, 'weather');
  const props = (w?.props ?? {}) as Record<string, unknown>;
  return {
    tempF: typeof props.tempF === 'number' ? props.tempF : null,
    conditions: typeof props.conditions === 'string' ? props.conditions : '—',
    // Absent widget is honestly "we don't know if this is fresh" -- treated
    // as stale (never claim LIVE data we don't have), not defaulted to false.
    stale: typeof props.stale === 'boolean' ? props.stale : true,
    forecast: Array.isArray(props.forecast)
      ? props.forecast.map(readForecastEntry).filter((f): f is DailyForecastView => f !== null)
      : [],
  };
}
