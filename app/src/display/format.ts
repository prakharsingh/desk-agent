const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatClock(now: number): { timeHHMM: string; timeSS: string } {
  const d = new Date(now);
  return { timeHHMM: `${pad2(d.getHours())}:${pad2(d.getMinutes())}`, timeSS: pad2(d.getSeconds()) };
}

export function formatDate(now: number): string {
  const d = new Date(now);
  return `${DAYS[d.getDay()]} ${pad2(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatUptime(startedAt: number, now: number): string {
  const elapsedSec = Math.max(0, Math.floor((now - startedAt) / 1000));
  const h = Math.floor(elapsedSec / 3600);
  const m = Math.floor((elapsedSec % 3600) / 60);
  const s = elapsedSec % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

export function formatAway(awayMs: number): string {
  const totalSec = Math.max(0, Math.floor(awayMs / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${pad2(s)}s`;
}

// Parsed as UTC y/m/d components (not `new Date(dateStr)`) so the weekday
// is deterministic regardless of the device's own timezone -- the date
// string names a calendar day, not an instant.
export function formatForecastDay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}
