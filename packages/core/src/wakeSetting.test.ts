import { describe, it, expect, vi } from 'vitest';
import { WakeSetting } from './wakeSetting.js';

function make(initial: boolean) {
  const sendToPhone = vi.fn();
  const notifyApp = vi.fn();
  return { setting: new WakeSetting(initial, { sendToPhone, notifyApp }), sendToPhone, notifyApp };
}

describe('WakeSetting', () => {
  it('starts at the boot-time config value', () => {
    expect(make(true).setting.get()).toBe(true);
    expect(make(false).setting.get()).toBe(false);
  });

  // Core is the serialization point: EVERY applied change (Mac or phone) is
  // reported to the Mac app, in the order core applied them, so main can
  // persist "whatever core last reported" and config.json can't end up
  // disagreeing with core after a simultaneous Mac + phone toggle.
  it('a Mac-originated change updates the live value, pushes it to the phone, and reports it to the Mac app (source mac)', () => {
    const { setting, sendToPhone, notifyApp } = make(true);
    setting.set(false, 'mac');
    expect(setting.get()).toBe(false);
    expect(sendToPhone).toHaveBeenCalledWith(false);
    expect(notifyApp).toHaveBeenCalledWith(false, 'mac');
  });

  it('a phone-originated change updates the live value, notifies the Mac app (to persist), and re-broadcasts to phones', () => {
    const { setting, sendToPhone, notifyApp } = make(true);
    setting.set(false, 'phone');
    expect(setting.get()).toBe(false);
    expect(notifyApp).toHaveBeenCalledWith(false, 'phone');
    expect(sendToPhone).toHaveBeenCalledWith(false);
  });

  it.each(['mac', 'phone'] as const)('setting the unchanged value from %s is a no-op: no rebroadcast, no app report', (source) => {
    const { setting, sendToPhone, notifyApp } = make(true);
    setting.set(true, source);
    expect(setting.get()).toBe(true);
    expect(sendToPhone).not.toHaveBeenCalled();
    expect(notifyApp).not.toHaveBeenCalled();
  });

  it('reports changes to the app in exactly the order core applied them', () => {
    const { setting, notifyApp } = make(true);
    setting.set(false, 'phone');
    setting.set(true, 'mac');
    setting.set(false, 'phone');
    expect(notifyApp.mock.calls).toEqual([[false, 'phone'], [true, 'mac'], [false, 'phone']]);
  });
});
