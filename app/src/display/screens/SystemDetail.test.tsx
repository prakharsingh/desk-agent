import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { SystemDetail } from './SystemDetail.js';
import { theme } from '../theme.js';
import type { SystemStatsView } from '../widgetReaders.js';

// Same recursive style search used by Card.test.tsx -- checks the rendered
// tree for a node whose flattened style contains { [prop]: value }, without
// hard-coding internal structure.
function hasStyledNode(node: any, prop: string, value: unknown): boolean {
  if (!node) return false;
  const styles = Array.isArray(node.props?.style) ? node.props.style.flat(Infinity) : [node.props?.style];
  if (styles.some((s: any) => s && s[prop] === value)) return true;
  const children = node.children;
  if (Array.isArray(children)) {
    return children.some((c: any) => hasStyledNode(c, prop, value));
  }
  return false;
}

const NORMAL_LOAD: SystemStatsView = {
  cpuPercent: 24,
  ramPercent: 61,
  battery: 'N/A',
  nowPlaying: '—',
  nowPlayingIsPlaying: false,
  nowPlayingArtwork: null,
};

const HIGH_RAM: SystemStatsView = { ...NORMAL_LOAD, ramPercent: 99 };

describe('SystemDetail', () => {
  it('renders formatted CPU and RAM percentages', async () => {
    await render(<SystemDetail stats={NORMAL_LOAD} cpuHistory={[]} ramHistory={[]} onBack={() => {}} />);
    expect(screen.getByText('24%')).toBeTruthy();
    expect(screen.getByText('61%')).toBeTruthy();
  });

  it('shows the honest AC-power label instead of the raw N/A battery sentinel', async () => {
    await render(<SystemDetail stats={NORMAL_LOAD} cpuHistory={[]} ramHistory={[]} onBack={() => {}} />);
    expect(screen.getByText('AC · DOCKED')).toBeTruthy();
    expect(screen.queryByText('N/A')).toBeNull();
  });

  it('passes a real battery percentage through unchanged', async () => {
    await render(
      <SystemDetail stats={{ ...NORMAL_LOAD, battery: '87%' }} cpuHistory={[]} ramHistory={[]} onBack={() => {}} />,
    );
    expect(screen.getByText('87%')).toBeTruthy();
  });

  it('computes MIN/AVG/PEAK over the live rolling window only, captioned honestly', async () => {
    await render(
      <SystemDetail stats={NORMAL_LOAD} cpuHistory={[10, 50, 90]} ramHistory={[60, 61, 62]} onBack={() => {}} />,
    );
    // CPU: min 10, avg 50, peak 90. RAM: min 60, avg 61, peak 62.
    expect(screen.getByText('10%')).toBeTruthy();
    expect(screen.getAllByText('90%').length).toBeGreaterThan(0);
    expect(screen.getAllByText('60%').length).toBeGreaterThan(0);
    expect(screen.getAllByText('62%').length).toBeGreaterThan(0);
    expect(screen.getAllByText('LIVE WINDOW').length).toBeGreaterThan(0);
  });

  it('shows an honest em-dash rather than a fabricated stat for an empty live window', async () => {
    await render(<SystemDetail stats={NORMAL_LOAD} cpuHistory={[]} ramHistory={[]} onBack={() => {}} />);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('never renders a persisted-history time range (no data exists for one)', async () => {
    await render(<SystemDetail stats={NORMAL_LOAD} cpuHistory={[10, 50, 90]} ramHistory={[]} onBack={() => {}} />);
    for (const label of ['1H', '6H', '24H', '7D']) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  it('tints the RAM metric card amber when sustained load is >= 90%, not the neutral color', async () => {
    const { toJSON } = await render(
      <SystemDetail stats={HIGH_RAM} cpuHistory={[]} ramHistory={[]} onBack={() => {}} />,
    );
    expect(hasStyledNode(toJSON(), 'backgroundColor', theme.colors.warn)).toBe(true);
    expect(hasStyledNode(toJSON(), 'backgroundColor', theme.colors.ram)).toBe(false);
  });
});
