import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ConfigSchema } from '@desk-agent/config-schema';

export function defaultConfigPath(): string {
  return path.join(os.homedir(), '.desk-agent', 'config.json');
}

// ConfigSchema.parse({}) applies every field's Zod default, so this is
// always exactly what a freshly-installed core would load -- no
// hand-maintained literal to keep in sync with the schema.
const DEFAULT_CONFIG = ConfigSchema.parse({});

// The existence check and the write are not atomic; today that's safe only
// because app.requestSingleInstanceLock() (index.ts) guarantees this runs
// once per machine and index.ts calls it exactly once at startup. If a
// future caller needs to invoke this more than once per process (a "reset to
// defaults" action, a retry-on-crash path, etc.), that caller is responsible
// for its own serialization -- this function does not provide any.
export function ensureConfigExists(configPath: string): void {
  if (fs.existsSync(configPath)) return;
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  // Write to a sibling temp file and rename into place (atomic on the same
  // filesystem) so a process kill mid-write can never leave a half-written,
  // unparseable config.json behind.
  const tmpPath = `${configPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(DEFAULT_CONFIG, null, 2));
  fs.renameSync(tmpPath, configPath);
}
