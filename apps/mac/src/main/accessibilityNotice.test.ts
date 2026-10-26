import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ACCESSIBILITY_SETTINGS_URL,
  AccessibilityNotice,
  NOTICE_DELAY_MS,
  TOUCH_NOTICE_ACTION,
  TOUCH_NOTICE_BODY,
  TOUCH_NOTICE_TITLE,
  retainedTouchNotification,
  showTouchNotification,
  type AccessibilityNoticeOptions,
  type NotificationLike,
  type TouchNotice,
} from './accessibilityNotice.js';

function setup(overrides: Partial<AccessibilityNoticeOptions> = {}, granted: boolean | null = false) {
  const requestPermissions = vi.fn();
  const checkPostEvent = vi.fn((done: (g: boolean | null) => void) => done(granted));
  const notify = vi.fn();
  const openSettings = vi.fn();
  const onLog = vi.fn();
  const notice = new AccessibilityNotice({ requestPermissions, checkPostEvent, notify, openSettings, onLog, ...overrides });
  return { notice, requestPermissions, checkPostEvent, notify, openSettings, onLog };
}

describe('AccessibilityNotice', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('asks the helper for the grant at once, but holds the notice back so it never lands on top of the macOS sheet', () => {
    const { notice, requestPermissions, checkPostEvent, notify } = setup();
    notice.onPostEventMissing();
    expect(requestPermissions).toHaveBeenCalledTimes(1);
    expect(checkPostEvent).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    vi.advanceTimersByTime(NOTICE_DELAY_MS - 1);
    expect(notify).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(checkPostEvent).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatchObject({ title: TOUCH_NOTICE_TITLE, body: TOUCH_NOTICE_BODY, actionText: TOUCH_NOTICE_ACTION });
  });

  it('waits about 3 s', () => {
    expect(NOTICE_DELAY_MS).toBe(3000);
  });

  it('skips the notice when the permission was granted in the meantime', () => {
    const { notice, notify, onLog } = setup({}, true);
    notice.onPostEventMissing();
    vi.advanceTimersByTime(NOTICE_DELAY_MS);
    expect(notify).not.toHaveBeenCalled();
    expect(onLog).toHaveBeenCalledWith('info', expect.stringContaining('granted'));
  });

  it('shows the notice when the re-check cannot tell', () => {
    const { notice, notify } = setup({}, null);
    notice.onPostEventMissing();
    vi.advanceTimersByTime(NOTICE_DELAY_MS);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('shows the notice when the re-check throws', () => {
    const { notice, notify, onLog } = setup({ checkPostEvent: () => { throw new Error('ENOENT'); } });
    notice.onPostEventMissing();
    vi.advanceTimersByTime(NOTICE_DELAY_MS);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(onLog).toHaveBeenCalledWith('warn', expect.stringContaining('ENOENT'));
  });

  it('does it at most once per launch', () => {
    const { notice, requestPermissions, notify } = setup();
    notice.onPostEventMissing();
    notice.onPostEventMissing();
    vi.advanceTimersByTime(NOTICE_DELAY_MS * 3);
    notice.onPostEventMissing();
    vi.advanceTimersByTime(NOTICE_DELAY_MS * 3);
    expect(requestPermissions).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('the notice action opens the Accessibility pane', () => {
    const { notice, notify, openSettings } = setup();
    notice.onPostEventMissing();
    vi.advanceTimersByTime(NOTICE_DELAY_MS);
    notify.mock.calls[0][0].onOpen();
    expect(openSettings).toHaveBeenCalledWith(ACCESSIBILITY_SETTINGS_URL);
  });

  it('opens the exact Privacy & Security › Accessibility URL', () => {
    expect(ACCESSIBILITY_SETTINGS_URL).toBe('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
  });

  it('still shows the notice when the permission request throws, and logs it', () => {
    const { notice, notify, onLog } = setup({ requestPermissions: () => { throw new Error('ENOENT'); } });
    notice.onPostEventMissing();
    vi.advanceTimersByTime(NOTICE_DELAY_MS);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(onLog).toHaveBeenCalledWith('warn', expect.stringContaining('ENOENT'));
  });

  it('a notice that cannot be shown is logged, never thrown', () => {
    const { notice, onLog } = setup({ notify: () => { throw new Error('no notifications'); } });
    notice.onPostEventMissing();
    expect(() => vi.advanceTimersByTime(NOTICE_DELAY_MS)).not.toThrow();
    expect(onLog).toHaveBeenCalledWith('warn', expect.stringContaining('no notifications'));
  });

  it('the copy says touch needs Accessibility and does not promise that it turns on by itself', () => {
    expect(`${TOUCH_NOTICE_TITLE} ${TOUCH_NOTICE_BODY}`).toMatch(/Accessibility/);
    expect(TOUCH_NOTICE_BODY).not.toMatch(/by itself/);
    expect(TOUCH_NOTICE_BODY).toMatch(/reconnect/);
    expect(TOUCH_NOTICE_ACTION).toBe('Open Settings');
  });
});

describe('showTouchNotification (I1: retained until the user is done with it)', () => {
  type Handler = () => void;
  function fakeFactory() {
    const made: Array<NotificationLike & { handlers: Record<string, Handler[]>; fire(e: string): void; shown: number; opts: unknown }> = [];
    const create = vi.fn((opts: unknown) => {
      const n = {
        handlers: {} as Record<string, Handler[]>,
        shown: 0,
        opts,
        on(event: 'action' | 'click' | 'close', cb: Handler) {
          (n.handlers[event] ??= []).push(cb);
          return n;
        },
        show() {
          n.shown++;
        },
        fire(e: string) {
          n.handlers[e]?.forEach((h) => h());
        },
      };
      made.push(n);
      return n;
    });
    return { create, made };
  }
  const notice = (onOpen = vi.fn()): TouchNotice => ({ title: 'T', body: 'B', actionText: 'Open Settings', onOpen });

  afterEach(() => {
    retainedTouchNotification.current = null;
  });

  it('shows it with the action button and keeps a module-level reference while it is up', () => {
    const { create, made } = fakeFactory();
    showTouchNotification(notice(), { isSupported: () => true, create, onLog: vi.fn() });
    expect(create).toHaveBeenCalledWith({ title: 'T', body: 'B', actions: [{ type: 'button', text: 'Open Settings' }] });
    expect(made[0].shown).toBe(1);
    expect(retainedTouchNotification.current).toBe(made[0]);
  });

  it('the action opens settings and releases it', () => {
    const { create, made } = fakeFactory();
    const onOpen = vi.fn();
    showTouchNotification(notice(onOpen), { isSupported: () => true, create, onLog: vi.fn() });
    made[0].fire('action');
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(retainedTouchNotification.current).toBeNull();
  });

  it('a click opens settings and releases it', () => {
    const { create, made } = fakeFactory();
    const onOpen = vi.fn();
    showTouchNotification(notice(onOpen), { isSupported: () => true, create, onLog: vi.fn() });
    made[0].fire('click');
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(retainedTouchNotification.current).toBeNull();
  });

  it('closing it releases it without opening settings', () => {
    const { create, made } = fakeFactory();
    const onOpen = vi.fn();
    showTouchNotification(notice(onOpen), { isSupported: () => true, create, onLog: vi.fn() });
    made[0].fire('close');
    expect(onOpen).not.toHaveBeenCalled();
    expect(retainedTouchNotification.current).toBeNull();
  });

  it('without notification support it logs the notice and creates nothing', () => {
    const { create } = fakeFactory();
    const onLog = vi.fn();
    showTouchNotification(notice(), { isSupported: () => false, create, onLog });
    expect(create).not.toHaveBeenCalled();
    expect(onLog).toHaveBeenCalledWith('warn', 'T: B');
    expect(retainedTouchNotification.current).toBeNull();
  });
});
