# Third-party notices

## SideScreen

Portions of `apps/mac/native/display-helper/Sources/DisplayHelperSystem/CaptureEncoder.swift`
are adapted from SideScreen's `MacHost/Sources/VideoEncoder.swift`: the VideoToolbox
compression-session property set for real-time, no-reordering streaming (RealTime,
AllowFrameReordering = false, MaxFrameDelayCount = 0, BT.709 colour tagging) and the
extraction of H.264 parameter sets from the sample's format description. The surrounding
pipeline (ScreenCaptureKit source, flow-control gating, Annex-B conversion, error mapping)
was written for Desk Agent.

Portions of `apps/android/android/app/src/main/java/com/deskagentapp/display/HardwareDecoder.kt`
are adapted from SideScreen's `VideoDecoder.kt`: the MediaCodec configure-retry pattern
(low-latency format first, then progressively simpler formats when configure fails). The
codec selection, Annex-B input handling, vendor keys and callbacks were written for Desk Agent.

```
MIT License

Copyright (c) 2025 Side Screen

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
