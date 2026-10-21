import DisplayHelperCore
import DisplayHelperSystem
import Foundation
import Testing

private final class AccessProbe: @unchecked Sendable {
    var granted = false
    var preflights = 0
    var requests = 0
    var access: ScreenCaptureAccess {
        ScreenCaptureAccess(preflight: { self.preflights += 1; return self.granted },
                            request: { self.requests += 1; return self.granted })
    }
}

/// Ruling (Checkpoint 1): `serve` never shows the Screen Recording prompt — preflight only. Prompting
/// is reserved for `--request-permissions` (Contract C). No display, no TCC calls.
@Suite struct RealDisplayBackendTests {
    @Test func missingScreenRecordingIsReportedWithoutPrompting() {
        let probe = AccessProbe()
        let backend = RealDisplayBackend(queue: DispatchQueue(label: "t"), screenCapture: probe.access)
        #expect(backend.preflightScreenRecording() == false)
        #expect(backend.preflightScreenRecording() == false)
        #expect(probe.preflights == 2)
        #expect(probe.requests == 0)
    }

    @Test func grantedScreenRecordingPassesPreflight() {
        let probe = AccessProbe()
        probe.granted = true
        let backend = RealDisplayBackend(queue: DispatchQueue(label: "t"), screenCapture: probe.access)
        #expect(backend.preflightScreenRecording())
        #expect(probe.requests == 0)
    }
}
