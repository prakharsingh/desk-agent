import type { Ctx, Plugin } from '@desk-agent/plugin-sdk';

export interface WeatherPluginConfig {
  location: string;
  intervalMs?: number;
}

interface Coordinates {
  latitude: number;
  longitude: number;
}

interface DailyForecast {
  date: string;
  tempMaxF: number;
  tempMinF: number;
  conditions: string;
}

interface WeatherReading {
  tempF: number;
  conditions: string;
  forecast: DailyForecast[];
}

const FALLBACK_READING: WeatherReading = { tempF: 0, conditions: 'unknown', forecast: [] };

// Open-Meteo's WMO weather-code table (https://open-meteo.com/en/docs) --
// every code it can return, mapped to a human-readable label.
const WEATHER_CODE_CONDITIONS: Record<number, string> = {
  0: 'Clear Sky',
  1: 'Mainly Clear',
  2: 'Partly Cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Depositing Rime Fog',
  51: 'Light Drizzle',
  53: 'Moderate Drizzle',
  55: 'Dense Drizzle',
  56: 'Light Freezing Drizzle',
  57: 'Dense Freezing Drizzle',
  61: 'Slight Rain',
  63: 'Moderate Rain',
  65: 'Heavy Rain',
  66: 'Light Freezing Rain',
  67: 'Heavy Freezing Rain',
  71: 'Slight Snow',
  73: 'Moderate Snow',
  75: 'Heavy Snow',
  77: 'Snow Grains',
  80: 'Slight Rain Showers',
  81: 'Moderate Rain Showers',
  82: 'Violent Rain Showers',
  85: 'Slight Snow Showers',
  86: 'Heavy Snow Showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm With Slight Hail',
  99: 'Thunderstorm With Heavy Hail',
};

export function describeWeatherCode(code: number): string {
  return WEATHER_CODE_CONDITIONS[code] ?? 'Unknown';
}

interface GeocodeResult {
  results?: Array<{ latitude: number; longitude: number }>;
}

interface ForecastResult {
  current: { temperature_2m: number; weather_code: number };
  daily: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    weather_code: number[];
  };
}

async function geocode(ctx: Ctx, location: string): Promise<Coordinates> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1`;
  const response = await ctx.http.fetch(url);
  const body = (await response.json()) as GeocodeResult;
  const first = body.results?.[0];
  if (!first) throw new Error(`no geocoding match for location "${location}"`);
  return { latitude: first.latitude, longitude: first.longitude };
}

function readForecast(coords: Coordinates, ctx: Ctx): Promise<Response> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${coords.latitude}&longitude=${coords.longitude}` +
    `&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code` +
    `&temperature_unit=fahrenheit&forecast_days=7&timezone=auto`;
  return ctx.http.fetch(url);
}

function toReading(body: ForecastResult): WeatherReading {
  return {
    tempF: body.current.temperature_2m,
    conditions: describeWeatherCode(body.current.weather_code),
    forecast: body.daily.time.map((date, i) => ({
      date,
      tempMaxF: body.daily.temperature_2m_max[i],
      tempMinF: body.daily.temperature_2m_min[i],
      conditions: describeWeatherCode(body.daily.weather_code[i]),
    })),
  };
}

export function createWeatherPlugin(config: WeatherPluginConfig): Plugin {
  const intervalMs = config.intervalMs ?? 10 * 60 * 1000;
  let lastGood: WeatherReading | null = null;
  let currentStale = true;
  // Geocoded once and cached for the plugin's lifetime -- the configured
  // location doesn't change at runtime, so there's no need to re-resolve
  // coordinates on every poll. Left null after a geocode failure so the
  // next poll retries it, rather than getting stuck.
  let cachedCoords: Coordinates | null = null;

  async function poll(ctx: Ctx) {
    try {
      if (!cachedCoords) cachedCoords = await geocode(ctx, config.location);
      const response = await readForecast(cachedCoords, ctx);
      const body = (await response.json()) as ForecastResult;
      const reading = toReading(body);
      lastGood = reading;
      currentStale = false;
      ctx.publishWidget('weather', { type: 'weather', props: { ...reading, stale: false } });
    } catch (err) {
      currentStale = true;
      const errorMessage = err instanceof Error ? err.message : String(err);
      ctx.log('warn', `weather fetch failed, using last-good: ${errorMessage}`);
      const fallback = lastGood ?? FALLBACK_READING;
      ctx.publishWidget('weather', { type: 'weather', props: { ...fallback, stale: true } });
    }
  }

  return {
    id: 'weather',
    permissions: ['net:api.weather'],
    init(ctx) {
      ctx.timer.setInterval(() => void poll(ctx), intervalMs);
      return poll(ctx);
    },
    getWidgets() {
      const fallback = lastGood ?? FALLBACK_READING;
      return [{ type: 'weather', props: { ...fallback, stale: currentStale } }];
    },
    onAction() {},
    onEvent() {},
  };
}

export const createPlugin = createWeatherPlugin;
