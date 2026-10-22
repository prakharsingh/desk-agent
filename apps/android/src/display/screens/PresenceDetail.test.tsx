import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { PresenceDetail } from './PresenceDetail.js';
import { UNKNOWN_SENSOR_FRAME } from '../sensorFrame.js';

const presence = { label: 'PRESENT', note: 'face seen', color: '#0f0' } as any;

function renderDetail(overrides: Partial<React.ComponentProps<typeof PresenceDetail>> = {}) {
  return render(
    <PresenceDetail
      presence={presence}
      sensorFrame={UNKNOWN_SENSOR_FRAME}
      cameraEnabled={false}
      onToggleCamera={() => {}}
      automationEnabled
      onBack={() => {}}
      onSleepNow={() => {}}
      wakeEnabled={null}
      {...overrides}
    />,
  );
}

describe('PresenceDetail Monitor wake', () => {
  it('renders the real Mac-synced wake value (ON)', async () => {
    await renderDetail({ wakeEnabled: true, onToggleWake: () => {} });
    expect(screen.getByRole('switch', { name: 'Monitor wake' }).props.accessibilityState).toEqual(expect.objectContaining({ checked: true }));
  });

  it('renders the real Mac-synced wake value (OFF)', async () => {
    await renderDetail({ wakeEnabled: false, onToggleWake: () => {} });
    expect(screen.getByRole('switch', { name: 'Monitor wake' }).props.accessibilityState).toEqual(expect.objectContaining({ checked: false }));
  });

  it('calls onToggleWake when the wake toggle is pressed', async () => {
    const onToggleWake = jest.fn();
    await renderDetail({ wakeEnabled: true, onToggleWake });
    await fireEvent.press(screen.getByRole('switch', { name: 'Monitor wake' }));
    expect(onToggleWake).toHaveBeenCalledTimes(1);
  });

  it('shows a waiting caption and is read-only while the Mac has not sent a value', async () => {
    await renderDetail({ wakeEnabled: null });
    expect(screen.getByText(/waiting for Mac/i)).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Monitor wake' }).props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
  });

  it('the camera presence toggle reflects cameraEnabled and calls back on press', async () => {
    const onToggleCamera = jest.fn();
    await renderDetail({ cameraEnabled: true, onToggleCamera });
    const sw = screen.getByRole('switch', { name: 'Camera presence' });
    expect(sw.props.accessibilityState).toEqual(expect.objectContaining({ checked: true }));
    await fireEvent.press(sw);
    expect(onToggleCamera).toHaveBeenCalledTimes(1);
  });
});
