import { z } from 'zod';

export const PresenceConfigSchema = z.object({
  absenceTimeoutMs: z.number().default(300_000),
  gazeIsKeepAwake: z.boolean().default(true),
  bootConfirmationTimeoutMs: z.number().default(300_000),
  wakeEnabled: z.boolean().default(true),
});

export const ConfigSchema = z.object({
  enabledPlugins: z.array(z.string()).default(['system-stats', 'weather', 'energy-saver']),
  weather: z.object({ apiKey: z.string(), location: z.string() }),
  presenceDebounceMs: z.number().default(30000),
  wsPort: z.number().default(8787),
  presence: PresenceConfigSchema.default({}),
});
export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(raw: unknown): Config {
  return ConfigSchema.parse(raw);
}
