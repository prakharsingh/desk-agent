import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { SettingsScreen } from './SettingsScreen.js';

const CONFIG_ON = { enabled: true, graceMs: 120000 };

describe('SettingsScreen', () => {
  it('renders ON when the screensaver is enabled', async () => {
    await render(<SettingsScreen config={CONFIG_ON} onChange={() => {}} onBack={() => {}} />);
    expect(screen.getByText('ON')).toBeTruthy();
  });

  it('renders OFF when the screensaver is disabled', async () => {
    await render(<SettingsScreen config={{ enabled: false, graceMs: 120000 }} onChange={() => {}} onBack={() => {}} />);
    expect(screen.getByText('OFF')).toBeTruthy();
  });

  it('toggling the switch calls onChange with enabled flipped, duration unchanged', async () => {
    const onChange = jest.fn();
    await render(<SettingsScreen config={CONFIG_ON} onChange={onChange} onBack={() => {}} />);
    await fireEvent.press(screen.getByText('ON'));
    expect(onChange).toHaveBeenCalledWith({ enabled: false, graceMs: 120000 });
  });

  it('pressing a duration preset calls onChange with that duration, enabled unchanged', async () => {
    const onChange = jest.fn();
    await render(<SettingsScreen config={CONFIG_ON} onChange={onChange} onBack={() => {}} />);
    await fireEvent.press(screen.getByText('5 MIN'));
    expect(onChange).toHaveBeenCalledWith({ enabled: true, graceMs: 300000 });
  });

  it('highlights the currently-active duration preset', async () => {
    await render(<SettingsScreen config={{ enabled: true, graceMs: 300000 }} onChange={() => {}} onBack={() => {}} />);
    // The active preset button carries a distinguishing accessibility state.
    expect(screen.getByText('5 MIN').parent?.props.accessibilityState?.selected).toBe(true);
    expect(screen.getByText('1 MIN').parent?.props.accessibilityState?.selected).toBe(false);
  });

  it('invokes onBack when the back control is pressed', async () => {
    const onBack = jest.fn();
    await render(<SettingsScreen config={CONFIG_ON} onChange={() => {}} onBack={onBack} />);
    await fireEvent.press(screen.getByText('‹ BACK'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
