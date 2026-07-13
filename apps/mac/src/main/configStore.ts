import fs from 'node:fs';
import { ConfigSchema, type Config } from '@desk-agent/config-schema';

export function readConfig(configPath: string): Config {
  const raw = fs.readFileSync(configPath, 'utf8');
  return ConfigSchema.parse(JSON.parse(raw));
}

// Validates before ever touching disk, so a rejected write can never
// clobber the last-known-good config file, and writes via a sibling temp
// file + rename (atomic on the same filesystem) so a crash mid-write can
// never leave a half-written, unparseable config.json behind -- same
// reasoning as firstRunConfig.ts's ensureConfigExists.
export function writeConfig(configPath: string, config: unknown): Config {
  const validated = ConfigSchema.parse(config);
  const tmpPath = `${configPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(validated, null, 2));
  fs.renameSync(tmpPath, configPath);
  return validated;
}
