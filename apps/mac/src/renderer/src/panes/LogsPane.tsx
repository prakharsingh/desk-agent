import { useState } from 'react';
import type { LogEntry } from '@desk-agent/core';
import { Segmented } from '../ui/Segmented';
import { monoFontFamily } from '../theme';

type LevelFilter = 'all' | 'info' | 'warn' | 'error';

const LEVEL_COLOR: Record<LogEntry['level'], string> = {
  info: '#64D2FF',
  warn: '#FF9F0A',
  error: '#FF453A',
};

const FILTER_OPTIONS: readonly { value: LevelFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warn' },
  { value: 'error', label: 'Error' },
];

export function LogsPane({ logs }: { logs: LogEntry[] }) {
  const [filter, setFilter] = useState<LevelFilter>('all');
  const filtered = filter === 'all' ? logs : logs.filter((l) => l.level === filter);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: '0 0 auto' }}>
        <Segmented options={FILTER_OPTIONS} value={filter} onChange={setFilter} />
        <span style={{ fontFamily: monoFontFamily, fontSize: 11, color: 'var(--text3)', marginLeft: 'auto' }}>
          event bus · live
        </span>
      </div>
      <div style={{ background: '#111214', border: '0.5px solid var(--border)', borderRadius: 10, padding: '14px 16px', flex: '1 1 auto', minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 5 }}>
        {filtered.length === 0 && <span style={{ fontFamily: monoFontFamily, fontSize: 11.5, color: 'var(--text3)' }}>No log lines yet.</span>}
        {filtered.map((entry, i) => (
          <div key={i} style={{ fontFamily: monoFontFamily, fontSize: 11.5, display: 'flex', gap: 10, lineHeight: 1.6 }}>
            <span style={{ color: '#4a5158' }}>{new Date(entry.ts).toLocaleTimeString()}</span>
            <span style={{ color: LEVEL_COLOR[entry.level], width: 42, flex: '0 0 42px', textTransform: 'uppercase', fontSize: 9.5, letterSpacing: 0.5, paddingTop: 2 }}>
              {entry.level}
            </span>
            <span style={{ color: '#5a6169', width: 58, flex: '0 0 58px' }}>{entry.source}</span>
            <span style={{ color: entry.level === 'info' ? '#c8ccd2' : LEVEL_COLOR[entry.level], flex: 1 }}>{entry.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
