import React from 'react';
import Svg, { Circle, Path, Line } from 'react-native-svg';
import { theme } from '../theme.js';
import type { WeatherIconKind } from '../weatherIcon.js';

const CLOUD_PATH = 'M4 15a4 4 0 0 1 .4-7.98 5 5 0 0 1 9.7-1.2A4.5 4.5 0 0 1 17 15z';

export function WeatherIcon({ kind, size = 18 }: { kind: WeatherIconKind; size?: number }) {
  const stroke = theme.colors.textDim;
  const accent = theme.colors.accent;

  switch (kind) {
    case 'sun':
      return (
        <Svg width={size} height={size} viewBox="0 0 20 20">
          <Circle cx={10} cy={10} r={4.5} fill={accent} />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
            <Line
              key={deg}
              x1={10 + 6.5 * Math.cos((deg * Math.PI) / 180)}
              y1={10 + 6.5 * Math.sin((deg * Math.PI) / 180)}
              x2={10 + 9 * Math.cos((deg * Math.PI) / 180)}
              y2={10 + 9 * Math.sin((deg * Math.PI) / 180)}
              stroke={accent}
              strokeWidth={1.4}
              strokeLinecap="round"
            />
          ))}
        </Svg>
      );
    case 'fog':
      return (
        <Svg width={size} height={size} viewBox="0 0 20 20">
          {[6, 10, 14].map((y) => (
            <Line key={y} x1={2} y1={y} x2={18} y2={y} stroke={stroke} strokeWidth={1.4} strokeLinecap="round" />
          ))}
        </Svg>
      );
    case 'rain':
      return (
        <Svg width={size} height={size} viewBox="0 0 20 20">
          <Path d={CLOUD_PATH} fill={stroke} />
          {[6, 10, 14].map((x) => (
            <Line key={x} x1={x} y1={16} x2={x - 1.5} y2={19} stroke={theme.colors.ram} strokeWidth={1.4} strokeLinecap="round" />
          ))}
        </Svg>
      );
    case 'snow':
      return (
        <Svg width={size} height={size} viewBox="0 0 20 20">
          <Path d={CLOUD_PATH} fill={stroke} />
          {[6, 10, 14].map((x) => (
            <Circle key={x} cx={x} cy={17.5} r={1} fill={theme.colors.text} />
          ))}
        </Svg>
      );
    case 'storm':
      return (
        <Svg width={size} height={size} viewBox="0 0 20 20">
          <Path d={CLOUD_PATH} fill={stroke} />
          <Path d="M11 14l-3 4h2.5l-1.5 3 4-4.5h-2.5z" fill={theme.colors.warn} />
        </Svg>
      );
    case 'cloud':
    default:
      return (
        <Svg width={size} height={size} viewBox="0 0 20 20">
          <Path d={CLOUD_PATH} fill={stroke} />
        </Svg>
      );
  }
}
