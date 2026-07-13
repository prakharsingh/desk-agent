import type { LogEntry } from '@desk-agent/core';

// Bounded so a long-running core session can't grow this unboundedly in the
// main process's memory; the Logs pane only ever needs recent history, not
// every line since launch.
export class LogBuffer {
  private entries: LogEntry[] = [];

  constructor(private cap: number) {}

  push(entry: LogEntry) {
    this.entries.push(entry);
    if (this.entries.length > this.cap) this.entries.shift();
  }

  getAll(): LogEntry[] {
    return this.entries;
  }
}
