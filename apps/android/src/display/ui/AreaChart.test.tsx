import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { AreaChart } from './AreaChart.js';
import { theme } from '../theme.js';

describe('AreaChart', () => {
  it('renders the fixed 0/50/100% axis labels regardless of the data', async () => {
    await render(<AreaChart history={[10, 90]} color={theme.colors.accent} width={100} height={40} />);
    expect(screen.getByText('100%')).toBeTruthy();
    expect(screen.getByText('50%')).toBeTruthy();
    expect(screen.getByText('0%')).toBeTruthy();
  });

  it('still renders the fixed axis labels for an empty live window (never fabricates data)', async () => {
    await render(<AreaChart history={[]} color={theme.colors.accent} width={100} height={40} />);
    expect(screen.getByText('100%')).toBeTruthy();
    expect(screen.getByText('0%')).toBeTruthy();
  });
});
