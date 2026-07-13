import fs from 'node:fs';
import { ConfigSchema, type Config } from '@desk-agent/config-schema';

export { ConfigSchema, PresenceConfigSchema, type Config } from '@desk-agent/config-schema';

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
