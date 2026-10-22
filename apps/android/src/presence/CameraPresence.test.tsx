import React from 'react';
import { render, screen, act } from '@testing-library/react-native';

// --- react-native-vision-camera: host-component / hook mocks -------------
// Native views are mocked as plain host components (strings) so the rendered
// tree records exactly which native views + props CameraPresence asks for.
// `useCamera` records every config it is called with, and counts session
// mounts/unmounts (a real `useCamera` creates its CameraSession in a mount
// effect and tears it down on unmount).
// currentResolution mirrors the real on-device Preview stream (sensor
// orientation, unrotated -- see HybridPreviewOutput.kt currentResolution).
const mockPreviewOutput = { __kind: 'preview-output', currentResolution: { width: 1440, height: 1080 } };
const mockFrameOutput = { __kind: 'frame-output' };
const mockUseCameraCalls: any[] = [];
const mockSession = { mounts: 0, unmounts: 0 };

jest.mock('react-native-vision-camera', () => {
  const mockReact = require('react');
  return {
    useCameraDevice: () => ({ id: 'front-device', position: 'front' }),
    useCameraPermission: () => ({ status: 'authorized', requestPermission: jest.fn() }),
    usePreviewOutput: () => mockPreviewOutput,
    useCamera: (props: any) => {
      mockUseCameraCalls.push(props);
      mockReact.useEffect(() => {
        mockSession.mounts++;
        return () => {
          mockSession.unmounts++;
        };
      }, []);
      return undefined;
    },
    Camera: 'Camera',
    NativePreviewView: 'NativePreviewView',
  };
});

let mockOnObservation: ((obs: any) => void) | null = null;
jest.mock('./frameProcessor.js', () => ({
  useFaceFrameProcessor: (cb: (obs: any) => void) => {
    mockOnObservation = cb;
    return mockFrameOutput;
  },
}));

const mockSetBBox = jest.fn();
jest.mock('./FaceBoxOverlay.js', () => {
  const mockReact = require('react');
  return {
    FaceBoxOverlay: mockReact.forwardRef((props: any, ref: any) => {
      mockReact.useImperativeHandle(ref, () => ({ setBBox: mockSetBBox }));
      return mockReact.createElement('FaceBoxOverlay', props);
    }),
  };
});

import { CameraPresence } from './CameraPresence.js';

function findAllByType(node: any, type: string, out: any[] = []): any[] {
  if (!node) return out;
  if (Array.isArray(node)) {
    node.forEach((n) => findAllByType(n, type, out));
    return out;
  }
  if (node.type === type) out.push(node);
  if (node.children) findAllByType(node.children, type, out);
  return out;
}

const NOOP = () => {};
const RECT = { x: 8, y: 120, width: 344, height: 140 };

async function renderPresence(previewRect: typeof RECT | null) {
  return await render(
    <CameraPresence enabled send={NOOP} connectionEpoch={0} previewRect={previewRect} />,
  );
}

function lastCameraConfig() {
  return mockUseCameraCalls[mockUseCameraCalls.length - 1];
}

beforeEach(() => {
  mockUseCameraCalls.length = 0;
  mockSession.mounts = 0;
  mockSession.unmounts = 0;
  mockOnObservation = null;
  mockSetBBox.mockClear();
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  (console.log as jest.Mock).mockRestore?.();
});

describe('CameraPresence camera session', () => {
  it('hidden camera never creates a preview surface', async () => {
    await renderPresence(null);
    const tree = screen.toJSON();

    // No native preview view of any kind (the SurfaceView-backed PreviewView
    // is what punched the black hole in the app window).
    expect(findAllByType(tree, 'NativePreviewView')).toHaveLength(0);
    expect(findAllByType(tree, 'Camera')).toHaveLength(0);

    // ...but the camera session is still running with the frame output
    // attached, so face/gaze/motion detection keeps working.
    const config = lastCameraConfig();
    expect(config).toBeDefined();
    expect(config.isActive).toBe(true);
    expect(config.device).toEqual({ id: 'front-device', position: 'front' });
    expect(config.outputs).toEqual([mockFrameOutput]);
    expect(config.outputs).not.toContain(mockPreviewOutput);
    expect(config.constraints).toEqual([{ fps: 15 }]);
  });

  it('with a previewRect, attaches the preview output and renders a visible preview at the rect', async () => {
    await renderPresence(RECT);
    const tree = screen.toJSON();

    const config = lastCameraConfig();
    expect(config.isActive).toBe(true);
    expect(config.outputs).toContain(mockPreviewOutput);
    expect(config.outputs).toContain(mockFrameOutput);

    const previews = findAllByType(tree, 'NativePreviewView');
    expect(previews).toHaveLength(1);
    expect(previews[0].props.previewOutput).toBe(mockPreviewOutput);
    expect(previews[0].props.resizeMode).toBe('contain');
    expect(findAllByType(tree, 'FaceBoxOverlay')).toHaveLength(1);
  });

  it('positions the preview through a plain wrapper View at the rect (the native PreviewView re-lays itself out at 0,0 of its parent)', async () => {
    // Regression: VisionCamera's HybridPreviewView installs a hierarchy
    // fitter (ViewGroup+installHierarchyFitter.kt) that calls
    // `parent.layout(0, 0, w, h)` on the PreviewView when CameraX adds its
    // SurfaceView child -- discarding any left/top RN gave the native view
    // itself. On device the preview landed at its parent's top-left, over
    // the header and the BACK control. So left/top must live on a plain
    // host View, and the PreviewView must sit at 0,0 filling it.
    await renderPresence(RECT);
    const tree = screen.toJSON();

    const wrappers = findAllByType(tree, 'View').filter((v) =>
      findAllByType(v.children, 'NativePreviewView').length > 0,
    );
    expect(wrappers.length).toBeGreaterThanOrEqual(1);
    const wrapper = wrappers[wrappers.length - 1]; // innermost
    const wrapperStyle = Object.assign({}, ...[wrapper.props.style].flat(Infinity).filter(Boolean));
    expect(wrapperStyle).toMatchObject({
      position: 'absolute',
      left: RECT.x,
      top: RECT.y,
      width: RECT.width,
      height: RECT.height,
      overflow: 'hidden',
    });
    expect(wrapper.children).toHaveLength(1);
    expect(wrapper.children[0].type).toBe('NativePreviewView');

    const preview = findAllByType(tree, 'NativePreviewView')[0];
    const previewStyle = Object.assign({}, ...[preview.props.style].flat(Infinity).filter(Boolean));
    // Fills the wrapper from its origin -- the only position the native
    // hierarchy fitter can't move it away from.
    expect(previewStyle).toMatchObject({ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 });
    expect(previewStyle.width).toBeUndefined();
    expect(previewStyle.height).toBeUndefined();
  });

  it('switching visible <-> hidden reconfigures the same session without leaving a stale preview surface', async () => {
    const { rerender } = await renderPresence(RECT);
    expect(findAllByType(screen.toJSON(), 'NativePreviewView')).toHaveLength(1);

    await rerender(<CameraPresence enabled send={NOOP} connectionEpoch={0} previewRect={null} />);
    expect(findAllByType(screen.toJSON(), 'NativePreviewView')).toHaveLength(0);
    expect(lastCameraConfig().outputs).toEqual([mockFrameOutput]);

    await rerender(<CameraPresence enabled send={NOOP} connectionEpoch={0} previewRect={RECT} />);
    expect(findAllByType(screen.toJSON(), 'NativePreviewView')).toHaveLength(1);
    expect(lastCameraConfig().outputs).toContain(mockPreviewOutput);

    // One session for the whole run: detection is never torn down by
    // navigating to/from the Presence screen, only the outputs change.
    expect(mockSession.mounts).toBe(1);
    expect(mockSession.unmounts).toBe(0);
  });

  it('keeps the outputs array referentially stable across re-renders with the same visibility', async () => {
    const { rerender } = await renderPresence(null);
    const first = lastCameraConfig().outputs;
    await rerender(<CameraPresence enabled send={NOOP} connectionEpoch={0} previewRect={null} />);
    expect(lastCameraConfig().outputs).toBe(first);
  });

  it('disabled -> no camera session at all', async () => {
    await render(<CameraPresence enabled={false} send={NOOP} connectionEpoch={0} previewRect={null} />);
    expect(mockUseCameraCalls).toHaveLength(0);
    expect(mockSession.mounts).toBe(0);
  });
});

describe('CameraPresence face-box overlay wiring', () => {
  it('pushes an upright, once-mirrored box sized to the upright frame', async () => {
    await renderPresence(RECT);
    expect(mockOnObservation).not.toBeNull();
    await act(async () => {
      mockOnObservation!({
        faceCount: 1,
        bbox: { x: 0.24, y: 0.82, width: 0.18, height: 0.32 },
        frameWidth: 1280,
        frameHeight: 720,
        rawBounds: { x: 308, y: 591, width: 230, height: 230 },
        orientation: 'right',
        isMirrored: true,
      });
    });
    expect(mockSetBBox).toHaveBeenCalledTimes(1);
    const arg = mockSetBBox.mock.calls[0][0];
    expect(arg.frameSize).toEqual({ width: 720, height: 1280 });
    expect(arg.bbox.x).toBeCloseTo(182 / 720, 6);
    expect(arg.bbox.y).toBeCloseTo(591 / 1280, 6);
    expect(arg.bbox.width).toBeCloseTo(230 / 720, 6);
    expect(arg.bbox.height).toBeCloseTo(230 / 1280, 6);
    // The PREVIEW's upright size (1440x1080 sensor-oriented, rotated by the
    // same 270deg) so the overlay maps against the displayed 4:3 image.
    expect(arg.previewFrameSize).toEqual({ width: 1080, height: 1440 });
  });

  it('logs facebox debug numbers at most once per second, only while the preview is visible', async () => {
    const nowSpy = jest.spyOn(Date, 'now');
    const obs = {
      faceCount: 1,
      bbox: { x: 0.24, y: 0.82, width: 0.18, height: 0.32 },
      frameWidth: 1280,
      frameHeight: 720,
      rawBounds: { x: 308, y: 591, width: 230, height: 230 },
      orientation: 'right',
      isMirrored: true,
    };
    const { rerender } = await renderPresence(RECT);
    const log = console.log as jest.Mock;
    const faceboxCalls = () => log.mock.calls.filter((c) => String(c[0]).includes('facebox'));

    nowSpy.mockReturnValue(10_000);
    await act(async () => mockOnObservation!(obs));
    nowSpy.mockReturnValue(10_500);
    await act(async () => mockOnObservation!(obs));
    expect(faceboxCalls()).toHaveLength(1);
    expect(String(faceboxCalls()[0][0])).toContain('rot=270');
    expect(String(faceboxCalls()[0][0])).toContain('frame=1280x720');

    nowSpy.mockReturnValue(11_100);
    await act(async () => mockOnObservation!(obs));
    expect(faceboxCalls()).toHaveLength(2);

    await rerender(<CameraPresence enabled send={NOOP} connectionEpoch={0} previewRect={null} />);
    nowSpy.mockReturnValue(20_000);
    await act(async () => mockOnObservation!(obs));
    expect(faceboxCalls()).toHaveLength(2);
    nowSpy.mockRestore();
  });
});
