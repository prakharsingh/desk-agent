// Touch on the phone display needs Accessibility (PostEvent) for Desk Agent. The helper reports a missing grant
// in `ready` (`postEvent: false`); on the first such report of each app launch main asks for the grant through the
// helper's `--request-permissions` (so Desk Agent appears in the Accessibility list and macOS may show its own
// sheet). Our notice follows NOTICE_DELAY_MS later, and only if the permission is still missing then (helper
// `--check`): never on top of the macOS sheet, and nothing when the user already allowed it. A denied TCC row can
// mean macOS never prompts again, which is why the notice exists at all. At most once per launch: no nagging.

export const ACCESSIBILITY_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility';
export const TOUCH_NOTICE_TITLE = 'Touch on Desk Agent Phone needs Accessibility';
export const TOUCH_NOTICE_BODY = "Allow Desk Agent in Privacy & Security › Accessibility, then reconnect the phone display if touch doesn't start.";
export const TOUCH_NOTICE_ACTION = 'Open Settings';
/** How long after `--request-permissions` the notice waits (and re-checks the permission). */
export const NOTICE_DELAY_MS = 3000;

export interface TouchNotice {
  title: string;
  body: string;
  actionText: string;
  /** The action button (or a click on the notice). */
  onOpen: () => void;
}

export interface AccessibilityNoticeOptions {
  /** Runs `desk-agent-display-helper --request-permissions` (fire and forget). */
  requestPermissions: () => void;
  /** Whether PostEvent is granted now (`desk-agent-display-helper --check`); null when that could not be told. */
  checkPostEvent: (done: (granted: boolean | null) => void) => void;
  notify: (notice: TouchNotice) => void;
  openSettings: (url: string) => void;
  onLog: (level: 'info' | 'warn', message: string) => void;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export class AccessibilityNotice {
  private done = false;

  constructor(private readonly opts: AccessibilityNoticeOptions) {}

  onPostEventMissing(): void {
    if (this.done) return;
    this.done = true;
    this.opts.onLog('info', 'touch is off: Accessibility (PostEvent) is not granted; asking macOS for it (once per launch)');
    try {
      this.opts.requestPermissions();
    } catch (err) {
      this.opts.onLog('warn', `could not ask for Accessibility: ${message(err)}`);
    }
    const t = setTimeout(() => this.recheck(), NOTICE_DELAY_MS);
    t.unref?.();
  }

  private recheck(): void {
    let answered = false;
    const answer = (granted: boolean | null) => {
      if (answered) return;
      answered = true;
      if (granted === true) {
        this.opts.onLog('info', 'Accessibility was granted meanwhile; no notice');
        return;
      }
      this.show();
    };
    try {
      this.opts.checkPostEvent(answer);
    } catch (err) {
      this.opts.onLog('warn', `could not re-check Accessibility: ${message(err)}`);
      answer(null);
    }
  }

  private show(): void {
    try {
      this.opts.notify({
        title: TOUCH_NOTICE_TITLE,
        body: TOUCH_NOTICE_BODY,
        actionText: TOUCH_NOTICE_ACTION,
        onOpen: () => this.opts.openSettings(ACCESSIBILITY_SETTINGS_URL),
      });
    } catch (err) {
      this.opts.onLog('warn', `could not show the Accessibility notice: ${message(err)}`);
    }
  }
}

/** The slice of Electron's `Notification` used here, so tests can inject a fake. */
export interface NotificationLike {
  on(event: 'action' | 'click' | 'close', cb: () => void): unknown;
  show(): void;
}

export interface NotificationDeps {
  isSupported: () => boolean;
  create: (opts: { title: string; body: string; actions: Array<{ type: 'button'; text: string }> }) => NotificationLike;
  onLog: (level: 'info' | 'warn', message: string) => void;
}

/**
 * The notification on screen, if any. Electron removes a `Notification` from Notification Center (and drops its
 * listeners) once it is garbage-collected, so it is held here until it is actioned, clicked or closed.
 */
export const retainedTouchNotification: { current: NotificationLike | null } = { current: null };

export function showTouchNotification(n: TouchNotice, deps: NotificationDeps): void {
  if (!deps.isSupported()) {
    deps.onLog('warn', `${n.title}: ${n.body}`);
    return;
  }
  const notification = deps.create({ title: n.title, body: n.body, actions: [{ type: 'button', text: n.actionText }] });
  const release = () => {
    if (retainedTouchNotification.current === notification) retainedTouchNotification.current = null;
  };
  // Actions show only for the Alerts style; a click on the banner opens the pane too.
  notification.on('action', () => {
    release();
    n.onOpen();
  });
  notification.on('click', () => {
    release();
    n.onOpen();
  });
  notification.on('close', release);
  retainedTouchNotification.current = notification;
  notification.show();
}
