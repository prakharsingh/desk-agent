export type TemperatureUnit = 'F' | 'C';

export function fahrenheitToCelsius(f: number): number {
  return (f - 32) * (5 / 9);
}

export function formatTemp(fahrenheit: number, unit: TemperatureUnit): string {
  const value = unit === 'C' ? fahrenheitToCelsius(fahrenheit) : fahrenheit;
  return `${Math.round(value)}°${unit}`;
}
