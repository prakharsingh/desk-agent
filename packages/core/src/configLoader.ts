import fs from 'node:fs';
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

/**
 * Load + validate the config file, turning the two normal first-run failure
 * modes (file missing, file not JSON) into errors that name the resolved
 * path and the fix instead of a raw ENOENT/SyntaxError stack.
 */
export function loadConfigFromFile(configPath: string): Config {
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch (err) {
    throw new Error(`config not found at ${configPath} — copy config.example.json there and edit it (${String(err)})`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`config at ${configPath} is not valid JSON: ${String(err)}`);
  }
  return loadConfig(parsed);
}
