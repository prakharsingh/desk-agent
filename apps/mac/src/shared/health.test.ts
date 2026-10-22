import { describe, expect, it } from 'vitest';
import type { StatusSnapshot } from '@desk-agent/core';
import { coreHealthLabel, coreHealthTone, overallHealth } from './health.js';

function snap(connected: number, tunnelStatus: 'idle' | 'reissued' | 'failed'): StatusSnapshot {
  return {
    clients: { connected, lastHelloAt: null },
    device: { tunnelStatus },
  } as unknown as StatusSnapshot;
}

describe('overallHealth (shared by the tray dot and the Overview headline)', () => {
  it('is red when the core crashed, even if a stale snapshot still shows the phone connected', () => {
    expect(overallHealth('crashed', snap(1, 'reissued'))).toEqual({ text: 'core crashed', tone: 'red' });
    expect(overallHealth('crashed', null)).toEqual({ text: 'core crashed', tone: 'red' });
  });

  it('is amber while the core is starting or stopped, regardless of any snapshot', () => {
    expect(overallHealth('starting', snap(1, 'reissued'))).toEqual({ text: 'core starting…', tone: 'amber' });
    expect(overallHealth('stopped', snap(1, 'reissued'))).toEqual({ text: 'core stopped', tone: 'amber' });
  });

  it('is amber when the renderer has not learned the core health yet', () => {
    expect(overallHealth('unknown', snap(1, 'reissued')).tone).toBe('amber');
  });

  it('is amber (never green) when the core is running but has not sent a snapshot yet', () => {
    expect(overallHealth('running', null)).toEqual({ text: 'waiting for the core to report in…', tone: 'amber' });
  });

  it('is red when the adb tunnel failed, even with a client connected', () => {
    expect(overallHealth('running', snap(1, 'failed'))).toEqual({ text: 'adb tunnel failed', tone: 'red' });
  });

  it('is red (tunnel rule wins) when the tunnel failed AND no phone app is connected', () => {
    expect(overallHealth('running', snap(0, 'failed'))).toEqual({ text: 'adb tunnel failed', tone: 'red' });
  });

  it('is amber when the phone app is not connected', () => {
    expect(overallHealth('running', snap(0, 'reissued'))).toEqual({ text: 'phone app not connected', tone: 'amber' });
    expect(overallHealth('running', snap(0, 'idle'))).toEqual({ text: 'phone app not connected', tone: 'amber' });
  });

  it('is green only when the core is running, the phone app is connected and the tunnel has not failed', () => {
    expect(overallHealth('running', snap(1, 'reissued'))).toEqual({ text: 'all systems healthy', tone: 'green' });
  });
});

describe('coreHealthLabel (tray status item + sidebar footer)', () => {
  it.each([
    ['running', 'Core running'],
    ['starting', 'Core starting…'],
    ['stopped', 'Core stopped'],
    ['crashed', 'Core crashed'],
    ['unknown', 'Checking core…'],
  ] as const)('%s -> %s', (health, label) => {
    expect(coreHealthLabel(health)).toBe(label);
  });
});

describe('coreHealthTone (Overview "Core agent" row)', () => {
  it.each([
    ['running', 'green'],
    ['crashed', 'red'],
    ['starting', 'amber'],
    ['stopped', 'amber'],
    ['unknown', 'amber'],
  ] as const)('%s -> %s', (health, tone) => {
    expect(coreHealthTone(health)).toBe(tone);
  });
});
