import Foundation
import Testing
@testable import DisplayHelperCore

@Suite struct HelperIOTests {
    @Test func parsesStartCommandLine() throws {
        let line = #"{"cmd":"start","sessionId":"s1","token":"tok","port":8788,"surfaceW":2340,"surfaceH":1080,"orientation":"landscape","serialNum":7,"vendorId":13398,"productId":19780,"dpi":420}"#
        guard case .start(let c) = try HelperCommand.decodeLine(line) else { Issue.record("not start"); return }
        #expect(c == StartCommand(sessionId: "s1", token: "tok", port: 8788, surfaceW: 2340, surfaceH: 1080,
                                  orientation: .landscape, serialNum: 7, vendorId: 13398, productId: 19780, dpi: 420))
    }

    @Test func startCommandDpiOptional() throws {
        let line = #"{"cmd":"start","sessionId":"s","token":"t","port":1,"surfaceW":1,"surfaceH":2,"orientation":"portrait","serialNum":1,"vendorId":2,"productId":3}"#
        guard case .start(let c) = try HelperCommand.decodeLine(line) else { Issue.record("not start"); return }
        #expect(c.dpi == nil)
    }

    @Test func parsesStop() throws {
        guard case .stop = try HelperCommand.decodeLine(#"{"cmd":"stop"}"#) else { Issue.record("not stop"); return }
    }

    @Test func rejectsBadCommands() {
        #expect(throws: (any Error).self) { try HelperCommand.decodeLine("nope") }
        #expect(throws: (any Error).self) { try HelperCommand.decodeLine(#"{"cmd":"explode"}"#) }
        #expect(throws: (any Error).self) { try HelperCommand.decodeLine(#"{"cmd":"start"}"#) }
    }

    @Test func endedEventLine() {
        #expect(HelperEvent.ended(.connectTimeout).jsonLine() == #"{"evt":"ended","reason":"connect-timeout"}"#)
    }

    @Test func otherEventLines() {
        #expect(HelperEvent.ready(displayId: 5, port: 8788).jsonLine() == #"{"displayId":5,"evt":"ready","port":8788}"#)
        #expect(HelperEvent.connected.jsonLine() == #"{"evt":"connected"}"#)
        #expect(HelperEvent.paused.jsonLine() == #"{"evt":"paused"}"#)
        #expect(HelperEvent.resumed.jsonLine() == #"{"evt":"resumed"}"#)
        #expect(HelperEvent.log(level: "warn", message: "a/b").jsonLine() == #"{"evt":"log","level":"warn","message":"a/b"}"#)
        let s = StatsEvent(fps: 60, kbps: 8000, unacked: 1, ackP50Ms: 4.5, ackP95Ms: 9, phoneRendered: 100, phoneDropped: 2)
        #expect(HelperEvent.stats(s).jsonLine() == #"{"ackP50Ms":4.5,"ackP95Ms":9,"evt":"stats","fps":60,"kbps":8000,"phoneDropped":2,"phoneRendered":100,"unacked":1}"#)
        #expect(!HelperEvent.connected.jsonLine().hasSuffix("\n"))
    }

    @Test func endReasonRawValues() {
        #expect(EndReason.stopRequested.rawValue == "stop-requested")
        #expect(EndReason.phoneBye.rawValue == "phone-bye")
        #expect(EndReason.watchdog.rawValue == "watchdog")
        #expect(EndReason.parentExit.rawValue == "parent-exit")
        #expect(EndReason.permissionScreenRecording.rawValue == "permission-screen-recording")
        #expect(EndReason.captureFailed.rawValue == "capture-failed")
        #expect(EndReason.portInUse.rawValue == "port-in-use")
        #expect(EndReason.captureUnavailable.rawValue == "capture-unavailable")
        #expect(EndReason.protocolError.rawValue == "protocol-error")
        #expect(EndReason.versionMismatch.rawValue == "version-mismatch")
        #expect(EndReason.unsupported.rawValue == "unsupported")
        #expect(EndReason.signal.rawValue == "signal")
        #expect(EndReason.connectTimeout.rawValue == "connect-timeout")
    }

    @Test func eventsAreEquatable() {
        #expect(HelperEvent.ended(.watchdog) == HelperEvent.ended(.watchdog))
        #expect(HelperEvent.ended(.watchdog) != HelperEvent.ended(.signal))
    }
}
