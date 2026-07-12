import React from 'react';
import Svg, { Polyline, Circle } from 'react-native-svg';
import { sparklinePoints } from '../sparkline.js';

export function Sparkline({
  history,
  color,
  width,
  height,
}: {
  history: number[];
  color: string;
  width: number;
  height: number;
}) {
  const { points, lastX, lastY } = sparklinePoints(history, width, height);

  return (
    <Svg width={width} height={height}>
      <Polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
      />
      <Circle cx={lastX} cy={lastY} r={2.4} fill={color} vectorEffect="non-scaling-stroke" />
    </Svg>
  );
}
