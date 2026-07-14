import { theme } from './theme.js';
import type { ConnectionState } from '../wsClient.js';

export interface ConnectionChip {
  color: string;
  label: string;
  dim?: boolean;
}

export function connectionChip(state: ConnectionState): ConnectionChip {
  switch (state) {
    case 'connected':
      return { color: theme.colors.accent, label: 'LIVE' };
    case 'connecting':
      return { color: theme.colors.textFaint, label: 'CONNECTING', dim: true };
    case 'tunnel-down':
    case 'server-down':
      return { color: theme.colors.alert, label: 'LINK DOWN' };
    default:
      return { color: theme.colors.textFaint, label: 'UNKNOWN' };
  }
}
