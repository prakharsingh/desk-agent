import React from 'react';
import { BackHandler, DeviceEventEmitter, NativeModules, StyleSheet } from 'react-native';
import { render, screen, fireEvent, act } from '@testing-library/react-native';
import { DisplayScreen, type DisplayScreenProps } from './DisplayScreen.js';
import { AppShell, type AppShellProps } from '../AppShell.js';
import { INITIAL_SCREEN_STATE } from '../screens.js';
import { UNKNOWN_SENSOR_FRAME } from '../sensorFrame.js';
import { noteDisplaySessionSeen, type SeenDisplaySessions } from '../displayFlow.js';

// The camera is irrelevant here and pulls in vision-camera native modules.
jest.mock('../../presence/CameraPresence.js', () => ({ CameraPresence: () => null }));

type Session = NonNullable<DisplayScreenProps['lastSession']>;
const SIZE = { w: 2340, h: 1080, orientation: 'landscape' as const, dpi: 420 };

let backListener: (() => boolean) | null = null;
let backRemove: jest.Mock;

beforeEach(() => {
  NativeModules.DisplayModule = {
    start: jest.fn(),
    stop: jest.fn(),
    requestSize: jest.fn(),
    setTrackpadMode: jest.fn(),
    setOrientation: jest.fn(),
    addListener: jest.fn(),
    removeListeners: jest.fn(),
  };
  backRemove = jest.fn();
  backListener = null;
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation(((_: string, l: () => boolean) => {
    backListener = l;
    return { remove: backRemove };
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const mod = () => NativeModules.DisplayModule as Record<string, jest.Mock>;
const frames = (sendFrame: jest.Mock) => sendFrame.mock.calls.map((c) => JSON.parse(c[0] as string));
const emitSize = () => act(() => void DeviceEventEmitter.emit('DisplaySurfaceSize', SIZE));
const session = (seq: number, payload: Session['payload']): Session => ({ seq, payload });
// Host nodes of the native display view (the SurfaceView) in the rendered tree.
type JsonNode = { type: string; children: (JsonNode | string)[] | null };
function surfaces(): JsonNode[] {
  const out: JsonNode[] = [];
  const walk = (n: JsonNode | string | null) => {
    if (n === null || typeof n === 'string') return;
    if (n.type === 'DeskAgentDisplayView') out.push(n);
    n.children?.forEach(walk);
  };
  const json = screen.toJSON() as JsonNode | JsonNode[] | null;
  (Array.isArray(json) ? json : [json]).forEach(walk);
  return out;
}

function setup(over: Partial<DisplayScreenProps> = {}) {
  const props: DisplayScreenProps = {
    lastSession: null,
    seenSessionIds: new Map(),
    getDisplaySeq: () => 0,
    jsonConnected: true,
    sendFrame: jest.fn(),
    onExit: jest.fn(),
    onUnsupported: jest.fn(),
    onSupported: jest.fn(),
    ...over,
  };
  return props;
}

async function toStarting(props: DisplayScreenProps) {
  const r = await render(<DisplayScreen {...props} />);
  await emitSize();
  await r.rerender(<DisplayScreen {...props} lastSession={session(1, { state: 'ready', sessionId: 's1', videoPort: 8788 })} />);
  return r;
}

describe('DisplayScreen', () => {
  it('asks native to re-emit the surface size right after subscribing', async () => {
    await render(<DisplayScreen {...setup()} />);
    expect(mod().requestSize).toHaveBeenCalledTimes(1);
  });

  it('hardware back while the Exit overlay shows hides it (Stay)', async () => {
    const props = setup();
    await toStarting(props);
    await act(() => {
      backListener!();
    });
    expect(screen.getByText('Exit display?')).toBeTruthy();
    await act(() => {
      expect(backListener!()).toBe(true);
    });
    expect(screen.queryByText('Exit display?')).toBeNull();
    expect(mod().stop).not.toHaveBeenCalled();
    expect(props.onExit).not.toHaveBeenCalled();
  });

  it('a failure while the Exit overlay shows drops it, and one Back then leaves', async () => {
    const props = setup();
    const r = await toStarting(props);
    await act(() => {
      backListener!();
    });
    expect(screen.getByText('Exit display?')).toBeTruthy();
    await r.rerender(<DisplayScreen {...props} lastSession={session(2, { state: 'error', sessionId: 's1', reason: 'helper-crashed' })} />);
    expect(screen.queryByText('Exit display?')).toBeNull();
    await act(() => {
      expect(backListener!()).toBe(true);
    });
    expect(props.onExit).toHaveBeenCalledTimes(1);
  });

  it('ignores a lastSession already present at mount', async () => {
    const props = setup({ lastSession: session(7, { state: 'error', sessionId: null, reason: 'unsupported' }) });
    await render(<DisplayScreen {...props} />);
    await emitSize();
    expect(props.onUnsupported).not.toHaveBeenCalled();
    expect(screen.queryByText('Not supported on this Mac')).toBeNull();
    expect(frames(props.sendFrame as jest.Mock).filter((f) => f.type === 'display.start')).toHaveLength(1);
  });

  it('unmounting while requesting sends stop with a null session', async () => {
    const props = setup();
    const r = await render(<DisplayScreen {...props} />);
    await emitSize();
    await r.unmount();
    const stops = frames(props.sendFrame as jest.Mock).filter((f) => f.type === 'display.stop');
    expect(stops).toHaveLength(1);
    expect(stops[0].payload).toEqual({ sessionId: null, reason: 'user-exit' });
    expect(mod().stop).not.toHaveBeenCalled();
  });

  it('sends display.start after the native size event', async () => {
    const props = setup();
    await render(<DisplayScreen {...props} />);
    expect(props.sendFrame).not.toHaveBeenCalled();
    await emitSize();
    const sent = frames(props.sendFrame as jest.Mock);
    expect(sent).toHaveLength(1);
    expect(sent[0].type).toBe('display.start');
    expect(sent[0].payload).toMatchObject({ w: 2340, h: 1080, orientation: 'landscape' });
  });

  it('a ready reply reports supported and starts native', async () => {
    const props = setup();
    await toStarting(props);
    expect(props.onSupported).toHaveBeenCalledTimes(1);
    expect(mod().start).toHaveBeenCalledWith('s1', 8788);
  });

  it('asks before exiting on hardware back, and Stay keeps the session', async () => {
    const props = setup();
    await toStarting(props);
    let handled = false;
    await act(() => {
      handled = backListener!();
    });
    expect(handled).toBe(true);
    expect(screen.getByText('Exit display?')).toBeTruthy();
    await fireEvent.press(screen.getByText('Stay'));
    expect(screen.queryByText('Exit display?')).toBeNull();
    expect(mod().stop).not.toHaveBeenCalled();
    expect(props.onExit).not.toHaveBeenCalled();
  });

  it('Exit stops native, tells core and leaves, without double-stopping on unmount', async () => {
    const props = setup();
    const r = await toStarting(props);
    await act(() => {
      backListener!();
    });
    await fireEvent.press(screen.getByText('Exit'));
    expect(mod().stop).toHaveBeenCalledTimes(1);
    const stops = frames(props.sendFrame as jest.Mock).filter((f) => f.type === 'display.stop');
    expect(stops).toHaveLength(1);
    expect(stops[0].payload).toEqual({ sessionId: 's1', reason: 'user-exit' });
    expect(props.onExit).toHaveBeenCalledTimes(1);
    await r.unmount();
    expect(mod().stop).toHaveBeenCalledTimes(1);
    expect(frames(props.sendFrame as jest.Mock).filter((f) => f.type === 'display.stop')).toHaveLength(1);
  });

  it('shows failure copy with a Back button', async () => {
    const props = setup();
    const r = await render(<DisplayScreen {...props} />);
    await emitSize();
    await r.rerender(<DisplayScreen {...props} lastSession={session(1, { state: 'error', sessionId: null, reason: 'unsupported' })} />);
    expect(screen.getByText('Not supported on this Mac')).toBeTruthy();
    expect(props.onUnsupported).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByText('Back'));
    expect(props.onExit).toHaveBeenCalledTimes(1);
    expect(mod().stop).not.toHaveBeenCalled();
  });

  // A SurfaceView punches a hole in the window that its unmount does not repair:
  // mounting one for the exited phase (the commit before AppShell goes Home)
  // blacked out the whole dashboard on the device.
  it('does not mount the display surface once the flow is terminal (failed, then exited on Back)', async () => {
    const props = setup();
    const r = await render(<DisplayScreen {...props} />);
    expect(surfaces().length).toBeGreaterThan(0); // sanity: measuring renders it
    await emitSize();
    await r.rerender(<DisplayScreen {...props} lastSession={session(1, { state: 'ended', sessionId: null, reason: 'permission-screen-recording' })} />);
    expect(surfaces()).toHaveLength(0);
    await fireEvent.press(screen.getByText('Back'));
    expect(props.onExit).toHaveBeenCalledTimes(1);
    expect(surfaces()).toHaveLength(0);
  });

  it('does not mount the display surface after a streaming session ends (exited)', async () => {
    const props = setup();
    const r = await toStarting(props);
    await r.rerender(<DisplayScreen {...props} lastSession={session(2, { state: 'ended', sessionId: 's1', reason: 'mac-ended' })} />);
    expect(props.onExit).toHaveBeenCalledTimes(1);
    expect(surfaces()).toHaveLength(0);
  });

  it('a mid-session display-offline offers Try again, which starts a new display session', async () => {
    const props = setup();
    await toStarting(props);
    await act(() => void DeviceEventEmitter.emit('DisplayState', { state: 'error', reason: 'display-offline' }));
    expect(screen.getByText(/macOS took Desk Agent Phone off the Mac's desktop/)).toBeTruthy();
    expect(screen.queryByText(/Control Center/)).toBeNull();
    expect(screen.getByText('Back')).toBeTruthy();
    expect(surfaces()).toHaveLength(0);
    const startsBefore = frames(props.sendFrame as jest.Mock).filter((f) => f.type === 'display.start').length;
    await fireEvent.press(screen.getByText('Try again'));
    expect(props.onExit).not.toHaveBeenCalled();
    // Measuring again: the surface is back, and its size sends a fresh display.start.
    expect(surfaces().length).toBeGreaterThan(0);
    await emitSize();
    expect(frames(props.sendFrame as jest.Mock).filter((f) => f.type === 'display.start')).toHaveLength(startsBefore + 1);
  });

  it('after three failed Try agains in a row the copy stops promising a fresh display but keeps Try again (M2)', async () => {
    const props = setup();
    const r = await render(<DisplayScreen {...props} />);
    let seq = 0;
    const failOffline = async () => {
      await emitSize();
      seq++;
      await r.rerender(<DisplayScreen {...props} lastSession={session(seq, { state: 'error', sessionId: `s${seq}`, reason: 'display-offline' })} />);
    };
    await failOffline(); // the first start
    for (let i = 1; i <= 3; i++) {
      expect(screen.getByText(/fresh display/)).toBeTruthy();
      await fireEvent.press(screen.getByText('Try again'));
      await failOffline();
    }
    expect(screen.queryByText(/fresh display/)).toBeNull();
    expect(screen.getByText(/macOS keeps switching Desk Agent Phone off/)).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
    expect(screen.getByText('Back')).toBeTruthy();
  });

  it('a session that streams resets the failed Try again count', async () => {
    const props = setup();
    const r = await render(<DisplayScreen {...props} />);
    let seq = 0;
    for (let i = 0; i < 3; i++) {
      await emitSize();
      seq++;
      await r.rerender(<DisplayScreen {...props} lastSession={session(seq, { state: 'error', sessionId: `s${seq}`, reason: 'display-offline' })} />);
      await fireEvent.press(screen.getByText('Try again'));
    }
    await emitSize();
    seq++;
    await r.rerender(<DisplayScreen {...props} lastSession={session(seq, { state: 'ready', sessionId: 'live', videoPort: 8788 })} />);
    await act(() => void DeviceEventEmitter.emit('DisplayState', { state: 'streaming', inputEnabled: true }));
    await act(() => void DeviceEventEmitter.emit('DisplayState', { state: 'error', reason: 'display-offline' }));
    expect(screen.getByText(/fresh display/)).toBeTruthy();
  });

  it('a start-time display-offline offers Try again and Back, without Control Center advice', async () => {
    const props = setup();
    const r = await render(<DisplayScreen {...props} />);
    await emitSize();
    await r.rerender(<DisplayScreen {...props} lastSession={session(1, { state: 'error', sessionId: 's1', reason: 'display-offline' })} />);
    expect(screen.getByText(/switched off on the Mac/)).toBeTruthy();
    expect(screen.queryByText(/Control Center/)).toBeNull();
    expect(screen.getByText('Try again')).toBeTruthy();
    await fireEvent.press(screen.getByText('Back'));
    expect(props.onExit).toHaveBeenCalledTimes(1);
  });

  it('a non-retryable failure shows Back only', async () => {
    const props = setup({ jsonConnected: false });
    await render(<DisplayScreen {...props} />);
    await emitSize();
    expect(screen.getByText('Mac not connected')).toBeTruthy();
    expect(screen.queryByText('Try again')).toBeNull();
  });

  it('hardware back while failed leaves without an overlay', async () => {
    const props = setup({ jsonConnected: false });
    await render(<DisplayScreen {...props} />);
    await emitSize();
    expect(screen.getByText('Mac not connected')).toBeTruthy();
    await act(() => {
      expect(backListener!()).toBe(true);
    });
    expect(screen.queryByText('Exit display?')).toBeNull();
    expect(props.onExit).toHaveBeenCalledTimes(1);
  });

  it('hardware back while requesting asks, and Exit sends stop with a null session', async () => {
    const props = setup();
    await render(<DisplayScreen {...props} />);
    await emitSize();
    await act(() => {
      backListener!();
    });
    await fireEvent.press(screen.getByText('Exit'));
    const stops = frames(props.sendFrame as jest.Mock).filter((f) => f.type === 'display.stop');
    expect(stops[0].payload).toEqual({ sessionId: null, reason: 'user-exit' });
    expect(props.onExit).toHaveBeenCalledTimes(1);
  });

  it('processes each lastSession seq once', async () => {
    const props = setup();
    const r = await toStarting(props);
    await r.rerender(<DisplayScreen {...props} lastSession={session(1, { state: 'ready', sessionId: 's1', videoPort: 8788 })} />);
    expect(props.onSupported).toHaveBeenCalledTimes(1);
    expect(mod().start).toHaveBeenCalledTimes(1);
  });

  it('runs effects once under StrictMode', async () => {
    const props = setup();
    await render(
      <React.StrictMode>
        <DisplayScreen {...props} />
      </React.StrictMode>,
    );
    await emitSize();
    expect(frames(props.sendFrame as jest.Mock).filter((f) => f.type === 'display.start')).toHaveLength(1);
  });

  it('leaving the screen mid-session stops native and tells core', async () => {
    const props = setup();
    const r = await toStarting(props);
    await r.unmount();
    expect(mod().stop).toHaveBeenCalledTimes(1);
    const stops = frames(props.sendFrame as jest.Mock).filter((f) => f.type === 'display.stop');
    expect(stops).toHaveLength(1);
    expect(stops[0].payload).toEqual({ sessionId: 's1', reason: 'user-exit' });
    expect(backRemove).toHaveBeenCalled();
  });

  it('does not send stop on unmount when the session already failed or never started', async () => {
    const props = setup();
    const r = await render(<DisplayScreen {...props} />);
    await r.unmount();
    expect(mod().stop).not.toHaveBeenCalled();
    expect(frames(props.sendFrame as jest.Mock).filter((f) => f.type === 'display.stop')).toHaveLength(0);
  });
});

// Mirrors App.tsx's display.session handling: an app-lifetime seq counter and
// seen-session record that outlive any one DisplayScreen visit.
function appSessions() {
  const seen: SeenDisplaySessions = new Map();
  let seq = 0;
  return {
    seen,
    getSeq: () => seq,
    deliver(payload: Session['payload']): Session {
      seq += 1;
      noteDisplaySessionSeen(seen, payload.sessionId, seq);
      return { seq, payload };
    },
  };
}

// M6: the exit dialog uses the banner's wording.
const TOUCH_OFF = "Touch is off — allow Desk Agent in Accessibility on the Mac, then reconnect if touch doesn't start";

async function toStreaming(props: DisplayScreenProps, inputEnabled: boolean) {
  const r = await toStarting(props);
  await act(() => void DeviceEventEmitter.emit('DisplayState', { state: 'streaming', inputEnabled }));
  return r;
}

const openOverlay = () =>
  act(() => {
    backListener!();
  });

describe('DisplayScreen trackpad mode and touch hint (Task 4.4)', () => {
  it('toggling trackpad mode calls the native module', async () => {
    await toStreaming(setup(), true);
    await openOverlay();
    const toggle = screen.getByLabelText('Trackpad mode');
    expect(toggle.props.accessibilityState).toMatchObject({ checked: false });
    await fireEvent.press(toggle);
    expect(mod().setTrackpadMode).toHaveBeenLastCalledWith(true);
    expect(screen.getByLabelText('Trackpad mode').props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent.press(screen.getByLabelText('Trackpad mode'));
    expect(mod().setTrackpadMode).toHaveBeenLastCalledWith(false);
    expect(mod().setTrackpadMode).toHaveBeenCalledTimes(2);
  });

  it('the trackpad toggle state survives closing and reopening the overlay', async () => {
    await toStreaming(setup(), true);
    await openOverlay();
    await fireEvent.press(screen.getByLabelText('Trackpad mode'));
    await fireEvent.press(screen.getByText('Stay'));
    expect(screen.queryByLabelText('Trackpad mode')).toBeNull();
    await openOverlay();
    expect(screen.getByLabelText('Trackpad mode').props.accessibilityState).toMatchObject({ checked: true });
    expect(mod().setTrackpadMode).toHaveBeenCalledTimes(1);
  });

  it('a new screen visit starts with trackpad mode off', async () => {
    const props = setup();
    const r = await toStreaming(props, true);
    await openOverlay();
    await fireEvent.press(screen.getByLabelText('Trackpad mode'));
    await r.unmount();
    await toStreaming(props, true);
    await openOverlay();
    expect(screen.getByLabelText('Trackpad mode').props.accessibilityState).toMatchObject({ checked: false });
  });

  it('one toggle press calls native once under StrictMode', async () => {
    const props = setup();
    await render(
      <React.StrictMode>
        <DisplayScreen {...props} />
      </React.StrictMode>,
    );
    await emitSize();
    await act(() => void DeviceEventEmitter.emit('DisplayState', { state: 'streaming', inputEnabled: true }));
    await openOverlay();
    await fireEvent.press(screen.getByLabelText('Trackpad mode'));
    expect(mod().setTrackpadMode).toHaveBeenCalledTimes(1);
    expect(mod().setTrackpadMode).toHaveBeenCalledWith(true);
  });

  it('shows the touch-off hint when input is disabled, in the same words as the banner', async () => {
    await toStreaming(setup(), false);
    await openOverlay();
    // The banner over the stream and the line in the exit dialog.
    expect(screen.getAllByText(TOUCH_OFF)).toHaveLength(2);
  });

  it('hides the touch-off hint when input is enabled', async () => {
    await toStreaming(setup(), true);
    await openOverlay();
    expect(screen.queryByText(TOUCH_OFF)).toBeNull();
  });
});

// The display SurfaceView sits behind the activity window and punches a hole in
// it. The window only recomputes that hole on a root layout, which Fabric never
// requests, so an overlay mounted in the same window over a live video is
// composited away (F1: the device showed only the strip where the status text
// had been). The prompt must live in its own window: an RN Modal.
describe('DisplayScreen exit prompt window (F1)', () => {
  type HostNode = { type: string; props: Record<string, unknown>; children: (HostNode | string)[] | null };
  // The host ancestors (outermost first) of the node whose text is `text`; with `inModal`, only a node inside a
  // Modal counts (the touch-off line is also the banner's text, over the stream outside the Modal).
  function hostPath(text: string, inModal = false): HostNode[] | null {
    const walk = (n: HostNode | string, path: HostNode[]): HostNode[] | null => {
      if (typeof n === 'string') return n === text && (!inModal || path.some((p) => p.type === 'Modal')) ? path : null;
      for (const c of n.children ?? []) {
        const hit = walk(c, [...path, n]);
        if (hit) return hit;
      }
      return null;
    };
    const json = screen.toJSON() as HostNode | HostNode[] | null;
    for (const root of Array.isArray(json) ? json : json ? [json] : []) {
      const hit = walk(root, []);
      if (hit) return hit;
    }
    return null;
  }

  it('renders the exit prompt, touch hint and controls inside a transparent full-screen Modal', async () => {
    await toStreaming(setup(), false);
    await openOverlay();
    for (const text of ['Exit display?', TOUCH_OFF, 'Trackpad mode', 'Stay', 'Exit']) {
      const path = hostPath(text, text === TOUCH_OFF);
      expect(path).not.toBeNull();
      const modal = path!.find((n) => n.type === 'Modal');
      expect(modal).toBeDefined();
      expect(modal!.props).toMatchObject({ visible: true, transparent: true, statusBarTranslucent: true, navigationBarTranslucent: true });
    }
    // The surface stays in the activity window, never inside the Modal.
    const modalHasSurface = (n: HostNode | string, inModal: boolean): boolean =>
      typeof n !== 'string' &&
      ((inModal && n.type === 'DeskAgentDisplayView') || (n.children ?? []).some((c) => modalHasSurface(c, inModal || n.type === 'Modal')));
    const json = screen.toJSON() as HostNode | HostNode[];
    expect((Array.isArray(json) ? json : [json]).some((n) => modalHasSurface(n, false))).toBe(false);
    expect(surfaces()).toHaveLength(1);
  });

  it('Back inside the Modal window (onRequestClose) is Stay', async () => {
    const props = setup();
    await toStreaming(props, true);
    await openOverlay();
    const modal = hostPath('Exit display?')!.find((n) => n.type === 'Modal')!;
    await act(() => {
      (modal.props.onRequestClose as () => void)();
    });
    expect(screen.queryByText('Exit display?')).toBeNull();
    expect(mod().stop).not.toHaveBeenCalled();
    expect(props.onExit).not.toHaveBeenCalled();
  });
});

describe('DisplayScreen retry after a failed session (I1)', () => {
  it("a retry ignores the failed session's late ended and adopts the new session's ready", async () => {
    const app = appSessions();
    const props = setup({ seenSessionIds: app.seen, getDisplaySeq: app.getSeq });
    // Visit 1: session A starts, then fails natively with token-timeout.
    const r1 = await render(<DisplayScreen {...props} />);
    await emitSize();
    const readyA = app.deliver({ state: 'ready', sessionId: 'A', videoPort: 8788 });
    await r1.rerender(<DisplayScreen {...props} lastSession={readyA} />);
    expect(mod().start).toHaveBeenLastCalledWith('A', 8788);
    await act(() => void DeviceEventEmitter.emit('DisplayState', { state: 'error', reason: 'token-timeout' }));
    expect(screen.getByText("Couldn't get the session key from the Mac")).toBeTruthy();
    expect(frames(props.sendFrame as jest.Mock).filter((f) => f.type === 'display.stop').map((f) => f.payload)).toEqual([
      { sessionId: 'A', reason: 'token-timeout' },
    ]);
    await fireEvent.press(screen.getByText('Back'));
    expect(props.onExit).toHaveBeenCalledTimes(1);
    await r1.unmount();

    // Visit 2: the user taps Display again; B's start is queued behind A's exit.
    const r2 = await render(<DisplayScreen {...props} lastSession={readyA} />);
    await emitSize();
    expect(frames(props.sendFrame as jest.Mock).filter((f) => f.type === 'display.start')).toHaveLength(2);
    // A finally exits and core broadcasts its end with A's own reason.
    const endedA = app.deliver({ state: 'ended', sessionId: 'A', reason: 'token-timeout' });
    await r2.rerender(<DisplayScreen {...props} lastSession={endedA} />);
    expect(screen.queryByText("Couldn't get the session key from the Mac")).toBeNull();
    expect(screen.getByText('Asking the Mac for a display…')).toBeTruthy();
    // B's ready is the answer to this visit's start.
    const readyB = app.deliver({ state: 'ready', sessionId: 'B', videoPort: 8788 });
    await r2.rerender(<DisplayScreen {...props} lastSession={readyB} />);
    expect(mod().start).toHaveBeenLastCalledWith('B', 8788);
    expect(mod().start).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Connecting…')).toBeTruthy();
  });

  it('a session first seen while the screen was closed is still stale on re-entry', async () => {
    const app = appSessions();
    const props = setup({ seenSessionIds: app.seen, getDisplaySeq: app.getSeq });
    // ready{A} arrives while no DisplayScreen is mounted (App still records it).
    const readyA = app.deliver({ state: 'ready', sessionId: 'A', videoPort: 8788 });
    const r = await render(<DisplayScreen {...props} lastSession={readyA} />);
    await emitSize();
    const endedA = app.deliver({ state: 'ended', sessionId: 'A', reason: 'stop-requested' });
    await r.rerender(<DisplayScreen {...props} lastSession={endedA} />);
    expect(screen.getByText('Asking the Mac for a display…')).toBeTruthy();
    expect(screen.queryByText('Display ended')).toBeNull();
  });

  it('a ready and its duplicate batched into one render are adopted (only the later seq is seen)', async () => {
    const app = appSessions();
    const props = setup({ seenSessionIds: app.seen, getDisplaySeq: app.getSeq });
    // an earlier session, so the counter is not at 0 when this start is sent
    const oldA = app.deliver({ state: 'ended', sessionId: 'A', reason: 'user-exit' });
    const r = await render(<DisplayScreen {...props} lastSession={oldA} />);
    await emitSize();
    // ready{B} (seq n) and a duplicate ready{B} (seq n+1) land in one React batch:
    // DisplayScreen only ever sees seq n+1, for a B first seen at n.
    app.deliver({ state: 'ready', sessionId: 'B', videoPort: 8788 });
    const dupB = app.deliver({ state: 'ready', sessionId: 'B', videoPort: 8788 });
    await r.rerender(<DisplayScreen {...props} lastSession={dupB} />);
    expect(mod().start).toHaveBeenCalledWith('B', 8788);
    expect(screen.getByText('Connecting…')).toBeTruthy();
  });

  it("a session id first seen after this screen's start is adopted on its own arrival", async () => {
    const app = appSessions();
    const props = setup({ seenSessionIds: app.seen, getDisplaySeq: app.getSeq });
    const r = await render(<DisplayScreen {...props} />);
    await emitSize();
    const errB = app.deliver({ state: 'error', sessionId: 'B', reason: 'no-device' });
    await r.rerender(<DisplayScreen {...props} lastSession={errB} />);
    expect(screen.getByText('Phone not detected over USB on the Mac')).toBeTruthy();
  });
});

describe('DisplayScreen native connect-failed (I2)', () => {
  it('a native connect-failed error tells core to stop the session and shows the copy', async () => {
    const props = setup();
    await toStarting(props);
    await act(() => void DeviceEventEmitter.emit('DisplayState', { state: 'error', reason: 'connect-failed' }));
    expect(screen.getByText("Couldn't connect to the Mac's display — try again")).toBeTruthy();
    const stops = frames(props.sendFrame as jest.Mock).filter((f) => f.type === 'display.stop');
    expect(stops.map((f) => f.payload)).toEqual([{ sessionId: 's1', reason: 'connect-failed' }]);
  });
});

describe('AppShell display screen', () => {
  it('renders no Header on the display screen', async () => {
    const noop = () => {};
    const props = {
      widgets: {},
      connectionState: 'connected',
      sensorFrame: UNKNOWN_SENSOR_FRAME,
      cameraEnabled: false,
      setCameraEnabled: noop,
      sendFrame: noop,
      connectionEpoch: 0,
      onSensor: noop,
      startedAt: 0,
      now: 0,
      screenState: { ...INITIAL_SCREEN_STATE, screen: 'display' },
      onGoSystem: noop,
      onGoWeather: noop,
      onGoPlaying: noop,
      onGoPresence: noop,
      onGoClock: noop,
      onGoVoice: noop,
      onGoDeck: noop,
      onGoLight: noop,
      onGoDisplay: noop,
      displayUnsupported: false,
      lastDisplaySession: null,
      seenDisplaySessions: new Map(),
      getDisplaySeq: () => 0,
      onDisplayUnsupported: noop,
      onDisplaySupported: noop,
      onBack: noop,
      onSleep: noop,
      onWake: noop,
      screensaverConfig: { enabled: true, graceMs: 120000 },
      onChangeScreensaverConfig: noop,
      onGoSettings: noop,
    } as AppShellProps;
    await render(<AppShell {...props} />);
    expect(screen.queryByText('AGENT')).toBeNull();
    await render(<AppShell {...props} screenState={INITIAL_SCREEN_STATE} />);
    expect(screen.getByText('AGENT')).toBeTruthy();
  });
});

// Overlays over the live stream live in fixed slots mounted with the surface (see displayOverlay.ts): they toggle
// opacity, never mount later (F1), and pass touches through to the Mac unless they are a control.
// Hidden slots are hidden from accessibility too, so the queries include hidden elements.
const slot = (testID: string) => screen.getByTestId(testID, { includeHiddenElements: true });
const opacity = (testID: string) => StyleSheet.flatten(slot(testID).props.style)?.opacity;
type HostNode = { type: string; props: Record<string, unknown>; children: (HostNode | string)[] | null };
// Whether the host node with `testID` sits inside a Modal (a separate window that would take every touch).
function inModal(testID: string): boolean | null {
  const walk = (n: HostNode | string, modal: boolean): boolean | null => {
    if (typeof n === 'string') return null;
    const here = modal || n.type === 'Modal';
    if (n.props.testID === testID) return here;
    for (const c of n.children ?? []) {
      const hit = walk(c, here);
      if (hit !== null) return hit;
    }
    return null;
  };
  const json = screen.toJSON() as HostNode | HostNode[] | null;
  for (const root of Array.isArray(json) ? json : json ? [json] : []) {
    const hit = walk(root, false);
    if (hit !== null) return hit;
  }
  return null;
}


describe('DisplayScreen touch-off banner (user report 3)', () => {
  const BANNER = TOUCH_OFF;

  it('is mounted from the first render, hidden, next to the surface and outside any Modal', async () => {
    await render(<DisplayScreen {...setup()} />);
    expect(surfaces()).toHaveLength(1);
    expect(screen.getByText(BANNER, { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByText(BANNER)).toBeNull(); // not announced while hidden
    expect(opacity('display-touch-banner')).toBe(0);
    expect(slot('display-touch-banner').props.pointerEvents).toBe('none');
    expect(inModal('display-touch-banner')).toBe(false);
  });

  it('shows while streaming with input off, and never takes touches', async () => {
    await toStreaming(setup(), false);
    expect(opacity('display-touch-banner')).toBe(1);
    expect(screen.getByText(BANNER)).toBeTruthy();
    expect(slot('display-touch-banner').props.pointerEvents).toBe('none');
  });

  it('stays hidden while input is on', async () => {
    await toStreaming(setup(), true);
    expect(opacity('display-touch-banner')).toBe(0);
  });

  it('hides as soon as input turns on mid-session, and returns when it is revoked', async () => {
    await toStreaming(setup(), false);
    await act(() => void DeviceEventEmitter.emit('DisplayState', { state: 'streaming', inputEnabled: true }));
    expect(opacity('display-touch-banner')).toBe(0);
    await act(() => void DeviceEventEmitter.emit('DisplayState', { state: 'streaming', inputEnabled: false }));
    expect(opacity('display-touch-banner')).toBe(1);
  });

  it('the same banner node survives the whole session (it is never remounted)', async () => {
    await render(<DisplayScreen {...setup()} />);
    const before = slot('display-touch-banner');
    await emitSize();
    await act(() => void DeviceEventEmitter.emit('DisplayState', { state: 'streaming', inputEnabled: false }));
    expect(slot('display-touch-banner')).toBe(before);
  });
});

describe('DisplayScreen rotate control (user report 3)', () => {
  const emitStream = (w: number, h: number) =>
    act(() => void DeviceEventEmitter.emit('DisplayStreamSize', { w, h, orientation: w >= h ? 'landscape' : 'portrait' }));
  const PORTRAIT = { w: 1080, h: 2260, orientation: 'portrait' as const, dpi: 420 };

  async function toStreamingPortrait(props: DisplayScreenProps) {
    const r = await render(<DisplayScreen {...props} />);
    await act(() => void DeviceEventEmitter.emit('DisplaySurfaceSize', PORTRAIT));
    await r.rerender(<DisplayScreen {...props} lastSession={session(1, { state: 'ready', sessionId: 's1', videoPort: 8788 })} />);
    await act(() => void DeviceEventEmitter.emit('DisplayState', { state: 'streaming', inputEnabled: true }));
    return r;
  }

  afterEach(() => jest.useRealTimers());

  it('is mounted with the surface but hidden and touch-transparent until streaming', async () => {
    await render(<DisplayScreen {...setup()} />);
    expect(opacity('display-rotate')).toBe(0);
    expect(slot('display-rotate').props.pointerEvents).toBe('none');
    expect(inModal('display-rotate')).toBe(false);
    expect(opacity('display-rotating')).toBe(0);
  });

  it('while streaming it is a small button that rotates to the other orientation', async () => {
    await toStreamingPortrait(setup());
    expect(opacity('display-rotate')).toBe(1);
    expect(slot('display-rotate').props.pointerEvents).toBe('auto');
    await fireEvent.press(screen.getByLabelText('Rotate display'));
    expect(mod().setOrientation).toHaveBeenCalledWith('landscape');
  });

  it('shows Rotating… until the stream arrives in the new orientation', async () => {
    await toStreamingPortrait(setup());
    await fireEvent.press(screen.getByLabelText('Rotate display'));
    expect(opacity('display-rotating')).toBe(1);
    expect(screen.getByText('Rotating…')).toBeTruthy();
    await emitStream(1080, 2260); // still the old stream
    expect(opacity('display-rotating')).toBe(1);
    await emitStream(2260, 1080);
    expect(opacity('display-rotating')).toBe(0);
  });

  it('Rotating… gives up after the timeout', async () => {
    jest.useFakeTimers({ now: 1_000_000 });
    await toStreamingPortrait(setup());
    await fireEvent.press(screen.getByLabelText('Rotate display'));
    expect(opacity('display-rotating')).toBe(1);
    await act(() => void jest.advanceTimersByTime(7000));
    expect(opacity('display-rotating')).toBe(0);
  });

  it('a second tap rotates back', async () => {
    await toStreamingPortrait(setup());
    await fireEvent.press(screen.getByLabelText('Rotate display'));
    await emitStream(2260, 1080);
    await act(() => void DeviceEventEmitter.emit('DisplaySurfaceSize', { w: 2260, h: 1080, orientation: 'landscape', dpi: 420 }));
    await fireEvent.press(screen.getByLabelText('Rotate display'));
    expect(mod().setOrientation).toHaveBeenLastCalledWith('portrait');
  });

  it('the session end restores auto-rotate once, when the user had rotated', async () => {
    const props = setup();
    const r = await toStreamingPortrait(props);
    await fireEvent.press(screen.getByLabelText('Rotate display'));
    await r.rerender(<DisplayScreen {...props} lastSession={session(2, { state: 'ended', sessionId: 's1', reason: 'mac-disconnect' })} />);
    expect(mod().setOrientation).toHaveBeenLastCalledWith('unspecified');
    await r.unmount();
    expect(mod().setOrientation.mock.calls.filter((c) => c[0] === 'unspecified')).toHaveLength(1);
  });

  it('leaving the screen mid-session restores auto-rotate', async () => {
    const r = await toStreamingPortrait(setup());
    await fireEvent.press(screen.getByLabelText('Rotate display'));
    await r.unmount();
    expect(mod().setOrientation).toHaveBeenLastCalledWith('unspecified');
  });

  it('a session the user never rotated leaves the orientation alone', async () => {
    const props = setup();
    const r = await toStreamingPortrait(props);
    await r.rerender(<DisplayScreen {...props} lastSession={session(2, { state: 'ended', sessionId: 's1', reason: 'mac-disconnect' })} />);
    await r.unmount();
    expect(mod().setOrientation).not.toHaveBeenCalled();
  });
});

describe('DisplayScreen placement hint (user report 3)', () => {
  const LEFT = 'Drag a window off the left edge of your main screen to move it here.';
  const PORTRAIT_TIP = ' Wide apps fit better in landscape — tap ⟳';

  afterEach(() => jest.useRealTimers());

  async function stream(props: DisplayScreenProps, size: typeof SIZE, side?: string) {
    const r = await render(<DisplayScreen {...props} />);
    await act(() => void DeviceEventEmitter.emit('DisplaySurfaceSize', size));
    await r.rerender(<DisplayScreen {...props} lastSession={session(1, { state: 'ready', sessionId: 's1', videoPort: 8788 })} />);
    await act(() => void DeviceEventEmitter.emit('DisplayState', { state: 'streaming', inputEnabled: true, ...(side ? { side } : {}) }));
    return r;
  }

  it('is mounted with the surface, hidden and touch-transparent before streaming', async () => {
    await render(<DisplayScreen {...setup()} />);
    expect(opacity('display-placement-hint')).toBe(0);
    expect(slot('display-placement-hint').props.pointerEvents).toBe('none');
    expect(inModal('display-placement-hint')).toBe(false);
  });

  it('once streaming, names the side of the main screen from the Mac', async () => {
    await stream(setup(), SIZE, 'left');
    expect(opacity('display-placement-hint')).toBe(1);
    expect(screen.getByText(LEFT)).toBeTruthy();
  });

  it('adds the landscape tip in portrait', async () => {
    await stream(setup(), { w: 1080, h: 2260, orientation: 'portrait', dpi: 420 } as unknown as typeof SIZE, 'left');
    expect(screen.getByText(LEFT + PORTRAIT_TIP)).toBeTruthy();
  });

  it('auto-hides after about 8 s and does not come back in the same session', async () => {
    jest.useFakeTimers({ now: 1_000_000 });
    await stream(setup(), SIZE, 'left');
    await act(() => void jest.advanceTimersByTime(7000));
    expect(opacity('display-placement-hint')).toBe(1);
    await act(() => void jest.advanceTimersByTime(2000));
    expect(opacity('display-placement-hint')).toBe(0);
    expect(slot('display-placement-hint').props.pointerEvents).toBe('none');
    await act(() => void DeviceEventEmitter.emit('DisplayState', { state: 'streaming', inputEnabled: false, side: 'left' }));
    expect(opacity('display-placement-hint')).toBe(0);
  });

  it('never swallows a tap meant for the Mac, even while it shows (M3)', async () => {
    await stream(setup(), SIZE, 'left');
    expect(opacity('display-placement-hint')).toBe(1);
    expect(slot('display-placement-hint').props.pointerEvents).toBe('none');
    // No pressable inside: the touch goes through to the surface.
    expect(screen.queryByRole('button', { name: LEFT })).toBeNull();
  });

  it('keeps clear of the touch banner below it', async () => {
    await stream(setup(), SIZE, 'left');
    const hint = StyleSheet.flatten(slot('display-placement-hint').props.style);
    const banner = StyleSheet.flatten(slot('display-touch-banner').props.style);
    expect(hint.bottom).toBeGreaterThanOrEqual((banner.bottom as number) + (banner.height as number));
  });
});
