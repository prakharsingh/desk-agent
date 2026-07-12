import React from 'react';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import { theme } from '../theme.js';

export type SectionIconKind = 'clock' | 'system' | 'presence' | 'playing' | 'voice' | 'deck' | 'light';

export function SectionIcon({ kind, size = 14 }: { kind: SectionIconKind; size?: number }) {
  const accent = theme.colors.accent;

  switch (kind) {
    case 'clock':
      return (
        <Svg width={size} height={size} viewBox="0 0 20 20">
          <Circle cx={10} cy={10} r={8} stroke={accent} strokeWidth={1.4} fill="none" />
          <Line x1={10} y1={10} x2={10} y2={5} stroke={accent} strokeWidth={1.4} strokeLinecap="round" />
          <Line x1={10} y1={10} x2={13.5} y2={12} stroke={accent} strokeWidth={1.4} strokeLinecap="round" />
        </Svg>
      );
    case 'system':
      return (
        <Svg width={size} height={size} viewBox="0 0 20 20">
          <Rect x={5} y={5} width={10} height={10} rx={1.5} stroke={accent} strokeWidth={1.4} fill="none" />
          <Rect x={8} y={8} width={4} height={4} stroke={accent} strokeWidth={1.2} fill="none" />
          {[6, 10, 14].map((pos) => (
            <React.Fragment key={pos}>
              <Line x1={pos} y1={2} x2={pos} y2={5} stroke={accent} strokeWidth={1.2} strokeLinecap="round" />
              <Line x1={pos} y1={15} x2={pos} y2={18} stroke={accent} strokeWidth={1.2} strokeLinecap="round" />
            </React.Fragment>
          ))}
        </Svg>
      );
    case 'presence':
      return (
        <Svg width={size} height={size} viewBox="0 0 20 20">
          <Circle cx={10} cy={7} r={3.2} stroke={accent} strokeWidth={1.4} fill="none" />
          <Path d="M4 17c0-3.6 2.7-6 6-6s6 2.4 6 6" stroke={accent} strokeWidth={1.4} fill="none" strokeLinecap="round" />
        </Svg>
      );
    case 'playing':
      return (
        <Svg width={size} height={size} viewBox="0 0 20 20">
          <Path d="M6 4l10 6-10 6z" fill={accent} />
        </Svg>
      );
    case 'voice':
      return (
        <Svg width={size} height={size} viewBox="0 0 20 20">
          <Rect x={7.5} y={2.5} width={5} height={9} rx={2.5} stroke={accent} strokeWidth={1.4} fill="none" />
          <Path d="M4.5 10.5a5.5 5.5 0 0 0 11 0" stroke={accent} strokeWidth={1.4} fill="none" strokeLinecap="round" />
          <Line x1={10} y1={16} x2={10} y2={18.5} stroke={accent} strokeWidth={1.4} strokeLinecap="round" />
        </Svg>
      );
    case 'deck':
      return (
        <Svg width={size} height={size} viewBox="0 0 20 20">
          <Rect x={1.5} y={6.5} width={17} height={9} rx={4} stroke={accent} strokeWidth={1.4} fill="none" />
          <Line x1={5.5} y1={11} x2={5.5} y2={11} stroke={accent} strokeWidth={2} strokeLinecap="round" />
          <Line x1={4} y1={11} x2={7} y2={11} stroke={accent} strokeWidth={1.4} strokeLinecap="round" />
          <Line x1={5.5} y1={9.5} x2={5.5} y2={12.5} stroke={accent} strokeWidth={1.4} strokeLinecap="round" />
          <Circle cx={14.5} cy={9.5} r={1.1} fill={accent} />
          <Circle cx={16.5} cy={11.5} r={1.1} fill={accent} />
        </Svg>
      );
    case 'light':
      return (
        <Svg width={size} height={size} viewBox="0 0 20 20">
          <Circle cx={10} cy={9} r={5} stroke={accent} strokeWidth={1.4} fill="none" />
          {[
            [10, 1, 10, 3],
            [10, 15, 10, 17],
            [3, 9, 1, 9],
            [17, 9, 19, 9],
            [4.8, 3.8, 3.4, 2.4],
            [15.2, 3.8, 16.6, 2.4],
          ].map(([x1, y1, x2, y2], i) => (
            <Line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={accent} strokeWidth={1.4} strokeLinecap="round" />
          ))}
        </Svg>
      );
    default:
      return null;
  }
}
