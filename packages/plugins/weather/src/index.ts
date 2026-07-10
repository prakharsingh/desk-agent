import type { Ctx, Plugin } from '@desk-agent/plugin-sdk';

export interface WeatherPluginConfig {
  apiKey: string;
  location: string;
  intervalMs?: number;
}

interface WeatherReading {
  tempF: number;
  conditions: string;
}

export function createWeatherPlugin(config: WeatherPluginConfig): Plugin {
  const intervalMs = config.intervalMs ?? 10 * 60 * 1000;
  let lastGood: WeatherReading | null = null;
  let currentStale = true;

  async function poll(ctx: Ctx) {
    try {
      const url = `https://api.weather.example/v1/current?location=${encodeURIComponent(config.location)}`;
      const response = await ctx.http.fetch(url, {
        headers: { Authorization: `Bearer ${config.apiKey}` },
      });
      const body = (await response.json()) as WeatherReading;
      lastGood = body;
      currentStale = false;
      ctx.publishWidget('weather', { type: 'weather', props: { ...body, stale: false } });
    } catch (err) {
      currentStale = true;
      const errorMessage = err instanceof Error ? err.message : String(err);
      ctx.log('warn', `weather fetch failed, using last-good: ${errorMessage}`);
      const fallback = lastGood ?? { tempF: 0, conditions: 'unknown' };
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
      const fallback = lastGood ?? { tempF: 0, conditions: 'unknown' };
      return [{ type: 'weather', props: { ...fallback, stale: currentStale } }];
    },
    onAction() {},
    onEvent() {},
  };
}

const defaultConfig: WeatherPluginConfig = {
  apiKey: process.env.WEATHER_API_KEY ?? '',
  location: process.env.WEATHER_LOCATION ?? '',
};

export default createWeatherPlugin(defaultConfig);
