export type WeatherIconKind = 'sun' | 'cloud' | 'rain' | 'snow' | 'fog' | 'storm';

// Derived from the conditions LABEL (not a WMO code -- the wire only ever
// carries the plugin's human-readable string), so this must cover every
// string describeWeatherCode() can emit. Order matters: check the more
// specific conditions (storm, snow) before the broader "rain" match, since
// e.g. "Thunderstorm" and "Slight Snow Showers" would otherwise never be
// reached if a looser rule matched first.
export function iconKindForConditions(conditions: string): WeatherIconKind {
  const c = conditions.toLowerCase();
  if (c.includes('thunderstorm')) return 'storm';
  if (c.includes('snow')) return 'snow';
  if (c.includes('fog')) return 'fog';
  if (c.includes('rain') || c.includes('drizzle')) return 'rain';
  if (c.includes('clear')) return 'sun';
  return 'cloud';
}
