import { describe, it, expect } from 'vitest';
import type { StatusSnapshot } from '@desk-agent/core';
import { cameraToggleState } from './presenceToggles.js';

function snap(connected: number, camera: { enabled: boolean } | null): StatusSnapshot {
  return { clients: { connected, lastHelloAt: null }, camera } as unknown as StatusSnapshot;
}

describe('cameraToggleState', () => {
  it('is disabled with a hint while the core has not reported (no snapshot)', () => {
    expect(cameraToggleState(null)).toEqual({ checked: false, disabled: true, hint: expect.stringMatching(/core/i) });
  });

  it('is disabled with a hint when no phone is connected, but still shows the last known value', () => {
    expect(cameraToggleState(snap(0, { enabled: true }))).toEqual({ checked: true, disabled: true, hint: expect.stringMatching(/phone.*not connected/i) });
  });

  it('is disabled with a hint when the phone is connected but has not reported its setting yet', () => {
    expect(cameraToggleState(snap(1, null))).toEqual({ checked: false, disabled: true, hint: expect.stringMatching(/waiting/i) });
  });

  it('mirrors the phone-reported value and is enabled when connected', () => {
    expect(cameraToggleState(snap(1, { enabled: true }))).toEqual({ checked: true, disabled: false, hint: null });
    expect(cameraToggleState(snap(1, { enabled: false }))).toEqual({ checked: false, disabled: false, hint: null });
  });
});
