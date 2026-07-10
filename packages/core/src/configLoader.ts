import { z } from 'zod';

export const ConfigSchema = z.object({
  enabledPlugins: z.array(z.string()).default(['system-stats', 'weather', 'energy-saver']),
  weather: z.object({ apiKey: z.string(), location: z.string() }),
  presenceDebounceMs: z.number().default(30000),
  wsPort: z.number().default(8787),
});
export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(raw: unknown): Config {
  return ConfigSchema.parse(raw);
}
