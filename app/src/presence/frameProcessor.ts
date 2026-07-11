import { useFrameOutput, type Frame, type CameraFrameOutput } from 'react-native-vision-camera';
import { useFaceDetector, type Face } from 'react-native-vision-camera-face-detector';
import { runOnJS } from 'react-native-worklets';
import type { FaceObservation } from './signalDeriver.js';

/**
 * React hook that wires the installed MLKit face-detection plugin
 * (`react-native-vision-camera-face-detector@2.0.6`) into a VisionCamera v5
 * `CameraFrameOutput`, mapping its native `Face[]` output to the fixed
 * `FaceObservation` shape consumed by `signalDeriver.ts` (Task B1) and
 * `App.tsx`'s camera wiring (Task C3).
 *
 * NOTE ON API VERSION: The task brief's reference code (`useFrameProcessor`
 * from `react-native-vision-camera` + `runOnJS` from
 * `react-native-worklets-core`) targets VisionCamera v3/v4's older JSI
 * frame-processor API. This project is pinned (Task C1) to VisionCamera
 * v5.1.0, a Nitro-modules rewrite that has no `useFrameProcessor` export at
 * all -- it was replaced by `useFrameOutput` (a `CameraFrameOutput` you pass
 * into `<Camera outputs={[...]}>`) plus `runOnJS` from `react-native-worklets`
 * (Software Mansion's renamed successor to the deprecated
 * `react-native-worklets-core`, confirmed in Task C1's dependency research).
 * This mirrors the pattern Task C1 exercised live on a OnePlus 6T
 * (~16.7fps, zero crashes) before it was reverted as throwaway spike code.
 *
 * `runClassifications: true` is required here -- without it, MLKit never
 * populates `leftEyeOpenProbability`/`rightEyeOpenProbability` on `Face`,
 * which `signalDeriver.ts`'s `deriveGazeAtScreen` depends on.
 *
 * `autoMode` is left at its default (`false`), so `face.bounds` stays in
 * raw frame-pixel coordinates -- this hook normalizes them to a [0, 1]
 * fraction of `frame.width` / `frame.height` before handing them to
 * `onObservation`, matching `FaceObservation.bbox`'s documented unit.
 *
 * BUGFIX (Task C2, verified live on a physically-connected OnePlus 6T):
 * MLKit's `detectFaces(frame)` was throwing on every real camera frame --
 * `IllegalArgumentException: Only JPEG and YUV_420_888 are supported now`.
 * Root cause, confirmed against the real installed source (not guessed):
 * `useFrameOutput`'s JS-level default for `pixelFormat` is `'native'`
 * (`node_modules/react-native-vision-camera/lib/hooks/useFrameOutput.js:68`),
 * and this hook was not overriding it. On Android, `HybridFrameOutput.kt`'s
 * `createUseCase` (`node_modules/react-native-vision-camera/android/.../
 * hybrids/outputs/HybridFrameOutput.kt:83-105`) switches on
 * `options.pixelFormat`:
 *   - `TargetVideoPixelFormat.NATIVE` -> `setImageReaderProxyProvider { ... }`
 *     using `PrivateImageReaderProxy`, i.e. `ImageAnalysis
 *     .OUTPUT_IMAGE_FORMAT_PRIVATE` -- a GPU-only buffer that is neither
 *     JPEG nor YUV_420_888.
 *   - `TargetVideoPixelFormat.YUV` -> explicitly `setOutputImageFormat(
 *     ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)` -- exactly what MLKit
 *     requires.
 * On this OnePlus 6T, the negotiated native format under `'native'` resolves
 * to that private/GPU format rather than YUV, so every frame handed to
 * `detectFaces` failed the plugin's input-format check. Passing
 * `pixelFormat: 'yuv'` to `useFrameOutput` forces the CPU-accessible
 * YUV_420_888 path MLKit needs. This matches `useFrameOutput.d.ts`'s own
 * `@discussion` block, which calls out MLKit as a worked example of a
 * consumer that "natively supports YUV, so streaming in `'yuv'` is most
 * efficient" (useFrameOutput.d.ts:80-82).
 */
export function useFaceFrameProcessor(
  onObservation: (obs: FaceObservation) => void,
): CameraFrameOutput {
  const faceDetector = useFaceDetector({
    performanceMode: 'fast',
    runClassifications: true,
  });

  return useFrameOutput({
    pixelFormat: 'yuv',
    onFrame(frame: Frame) {
      'worklet';
      const faces: Face[] = faceDetector.detectFaces(frame);

      if (faces.length === 0) {
        runOnJS(onObservation)({ faceCount: 0 });
        frame.dispose();
        return;
      }

      const face = faces[0]!;
      const frameWidth = frame.width;
      const frameHeight = frame.height;

      runOnJS(onObservation)({
        faceCount: faces.length,
        bbox: {
          x: face.bounds.x / frameWidth,
          y: face.bounds.y / frameHeight,
          width: face.bounds.width / frameWidth,
          height: face.bounds.height / frameHeight,
        },
        eulerX: face.pitchAngle,
        eulerY: face.yawAngle,
        leftEyeOpenProbability: face.leftEyeOpenProbability,
        rightEyeOpenProbability: face.rightEyeOpenProbability,
      });

      frame.dispose();
    },
  });
}
