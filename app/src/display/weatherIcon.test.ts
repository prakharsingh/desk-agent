import { describe, it, expect } from 'vitest';
import { iconKindForConditions } from './weatherIcon.js';

describe('iconKindForConditions', () => {
  it.each([
    ['Clear Sky', 'sun'],
    ['Mainly Clear', 'sun'],
    ['Partly Cloudy', 'cloud'],
    ['Overcast', 'cloud'],
    ['Fog', 'fog'],
    ['Depositing Rime Fog', 'fog'],
    ['Light Drizzle', 'rain'],
    ['Moderate Drizzle', 'rain'],
    ['Dense Drizzle', 'rain'],
    ['Light Freezing Drizzle', 'rain'],
    ['Dense Freezing Drizzle', 'rain'],
    ['Slight Rain', 'rain'],
    ['Moderate Rain', 'rain'],
    ['Heavy Rain', 'rain'],
    ['Light Freezing Rain', 'rain'],
    ['Heavy Freezing Rain', 'rain'],
    ['Slight Snow', 'snow'],
    ['Moderate Snow', 'snow'],
    ['Heavy Snow', 'snow'],
    ['Snow Grains', 'snow'],
    ['Slight Rain Showers', 'rain'],
    ['Moderate Rain Showers', 'rain'],
    ['Violent Rain Showers', 'rain'],
    ['Slight Snow Showers', 'snow'],
    ['Heavy Snow Showers', 'snow'],
    ['Thunderstorm', 'storm'],
    ['Thunderstorm With Slight Hail', 'storm'],
    ['Thunderstorm With Heavy Hail', 'storm'],
    ['Unknown', 'cloud'],
    ['—', 'cloud'],
  ])('maps %s to %s', (conditions, expected) => {
    expect(iconKindForConditions(conditions)).toBe(expected);
  });
});
