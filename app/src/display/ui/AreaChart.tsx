import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Polygon, Polyline, Circle, Line, Defs, LinearGradient, Stop } from 'react-native-svg';
import { theme } from '../theme.js';
import { areaChartGeometry, chartGridLines } from '../areaChartGeometry.js';

// Axis-labeled, area-filled chart over the live rolling window only (the
// same ~40-sample history AppShell already keeps for the small home-screen
// Sparkline). Deliberately uses a FIXED 0-100% y-scale -- see
// areaChartGeometry.ts -- because this chart draws truthful 0/50/100%
// gridline labels, unlike the auto-scaled small Sparkline.
export function AreaChart({
  history,
  color,
  width,
  height,
  fillOpacity = 0.28,
}: {
  history: number[];
  color: string;
  width: number;
  height: number;
  fillOpacity?: number;
}) {
  const { linePoints, areaPoints, lastX, lastY } = areaChartGeometry(history, width, height);
  const gridLines = chartGridLines(height);
  // One gradient per color so CPU (accent) and RAM (ram) charts on the same
  // screen don't collide on a shared <Defs> id.
  const gradientId = `areaChartFill-${color.replace(/[^a-zA-Z0-9]/g, '')}`;

  return (
    <View style={{ width, height }}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity={fillOpacity} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        {gridLines.map((g) => (
          <Line key={g.pct} x1={0} y1={g.y} x2={width} y2={g.y} stroke={theme.colors.gridLine} strokeWidth={1} />
        ))}
        {areaPoints ? <Polygon points={areaPoints} fill={`url(#${gradientId})`} /> : null}
        {linePoints ? (
          <Polyline
            points={linePoints}
            fill="none"
            stroke={color}
            strokeWidth={1.6}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {linePoints ? <Circle cx={lastX} cy={lastY} r={2.6} fill={color} vectorEffect="non-scaling-stroke" /> : null}
      </Svg>
      {gridLines.map((g) => (
        <Text key={g.pct} style={[styles.axisLabel, { top: g.y - 6 }]}>
          {g.pct}%
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  axisLabel: {
    position: 'absolute',
    left: 2,
    fontSize: 9,
    color: theme.colors.textFainter,
    fontFamily: theme.font.regular,
  },
});
