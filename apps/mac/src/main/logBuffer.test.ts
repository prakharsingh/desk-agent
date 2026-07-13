import { describe, it, expect } from 'vitest';
import { LogBuffer } from './logBuffer.js';

describe('LogBuffer', () => {
  it('returns entries in insertion order', () => {
    const buffer = new LogBuffer(10);
    buffer.push({ ts: 1, level: 'info', source: 'core', message: 'a' });
    buffer.push({ ts: 2, level: 'warn', source: 'core', message: 'b' });
    expect(buffer.getAll().map((e) => e.message)).toEqual(['a', 'b']);
  });

  it('drops the oldest entries once the cap is exceeded, keeping only the most recent `cap`', () => {
    const buffer = new LogBuffer(3);
    for (let i = 1; i <= 5; i++) buffer.push({ ts: i, level: 'info', source: 'core', message: `m${i}` });
    expect(buffer.getAll().map((e) => e.message)).toEqual(['m3', 'm4', 'm5']);
  });

  it('starts empty', () => {
    expect(new LogBuffer(10).getAll()).toEqual([]);
  });
});
