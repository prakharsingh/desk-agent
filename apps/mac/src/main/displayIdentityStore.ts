import fs from 'node:fs';
import path from 'node:path';

// Per-phone display-identity generation (Ruling P0-7). Machine state, not a user setting: it lives next
// to config.json (~/.desk-agent) but in its own file, so a settings save from the renderer can never
// roll it back and core never loads it. Same write discipline as configStore.ts: validate before
// touching disk, then a sibling temp file + rename (atomic on the same filesystem).

interface State {
  version: 1;
  generations: Record<string, number>;
}

const isGeneration = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

function parseState(raw: unknown): State | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== 1 || typeof o.generations !== 'object' || o.generations === null || Array.isArray(o.generations)) return null;
  const generations = o.generations as Record<string, unknown>;
  if (!Object.values(generations).every(isGeneration)) return null;
  return { version: 1, generations: { ...(generations as Record<string, number>) } };
}

export interface DisplayIdentityGenerations {
  getGeneration(phoneKey: string): number;
  setGeneration(phoneKey: string, generation: number): void;
}

export class DisplayIdentityStore implements DisplayIdentityGenerations {
  constructor(private readonly filePath: string) {}

  /** 0 when nothing is saved for this phone, or the file is missing or invalid. Never throws. */
  getGeneration(phoneKey: string): number {
    const { generations } = this.read();
    return Object.hasOwn(generations, phoneKey) ? generations[phoneKey]! : 0;
  }

  /** Throws (without touching disk) on an invalid generation, and on a write error. */
  setGeneration(phoneKey: string, generation: number): void {
    if (!isGeneration(generation)) throw new Error(`invalid display identity generation: ${generation}`);
    const next: State = { version: 1, generations: { ...this.read().generations, [phoneKey]: generation } };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(next, null, 2));
    fs.renameSync(tmpPath, this.filePath);
  }

  private read(): State {
    try {
      return parseState(JSON.parse(fs.readFileSync(this.filePath, 'utf8'))) ?? { version: 1, generations: {} };
    } catch {
      return { version: 1, generations: {} };
    }
  }
}
