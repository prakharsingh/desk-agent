import Foundation
import Testing
@testable import DisplayHelperCore

@Suite struct LineSplitterTests {
    @Test func splitsCompleteLinesAndKeepsTheRemainder() {
        var s = LineSplitter()
        #expect(s.append(Data("a\nbc".utf8)) == ["a"])
        #expect(s.append(Data("d\n\ne\n".utf8)) == ["bcd", "", "e"])
        #expect(s.finish() == nil)
    }

    @Test func stripsCarriageReturns() {
        var s = LineSplitter()
        #expect(s.append(Data("x\r\ny\r\n".utf8)) == ["x", "y"])
    }

    @Test func finishReturnsAnUnterminatedTail() {
        var s = LineSplitter()
        #expect(s.append(Data("{\"cmd\":\"stop\"}".utf8)).isEmpty)
        #expect(s.finish() == #"{"cmd":"stop"}"#)
        #expect(s.finish() == nil)
    }

    @Test func handlesMultibyteSplitAcrossReads() {
        var s = LineSplitter()
        let bytes = Array("é\n".utf8)   // 0xC3 0xA9 0x0A
        #expect(s.append(Data(bytes[0..<1])).isEmpty)
        #expect(s.append(Data(bytes[1...])) == ["é"])
    }

    @Test func dropsAnOverlongLine() {
        var s = LineSplitter(maxLineBytes: 8)
        #expect(s.append(Data("0123456789".utf8)).isEmpty)
        #expect(s.append(Data("abc\nok\n".utf8)) == ["ok"])
    }
}

@Suite struct ServeInputTests {
    static let startLine = #"{"cmd":"start","sessionId":"s1","token":"t0ken","port":8788,"surfaceW":2340,"surfaceH":1080,"orientation":"landscape","serialNum":1,"vendorId":13398,"productId":19780}"#

    @Test func firstLineMustBeStart() {
        var input = ServeInput()
        guard case .start(let cmd) = input.line(Self.startLine) else { Issue.record("expected start"); return }
        #expect(cmd.sessionId == "s1")
        #expect(cmd.port == 8788)
        #expect(input.started)
    }

    @Test func invalidOrNonStartFirstLineIsAUsageError() {
        var a = ServeInput()
        guard case .usageError = a.line("garbage") else { Issue.record("expected usageError"); return }
        var b = ServeInput()
        guard case .usageError = b.line(#"{"cmd":"stop"}"#) else { Issue.record("expected usageError"); return }
        #expect(!b.started)
    }

    @Test func eofBeforeStartIsAUsageError() {
        var input = ServeInput()
        guard case .usageError = input.eof() else { Issue.record("expected usageError"); return }
    }

    @Test func stopAfterStartRequestsStop() {
        var input = ServeInput()
        _ = input.line(Self.startLine)
        #expect(input.line(#"{"cmd":"stop"}"#) == .stop(.stopRequested))
    }

    @Test func eofAfterStartIsParentExit() {
        var input = ServeInput()
        _ = input.line(Self.startLine)
        #expect(input.eof() == .stop(.parentExit))
    }

    @Test func blankLinesAreIgnored() {
        var input = ServeInput()
        #expect(input.line("") == .ignore(nil))
        #expect(!input.started)
    }

    @Test func secondStartAndGarbageAfterStartAreIgnoredWithAWarning() {
        var input = ServeInput()
        _ = input.line(Self.startLine)
        guard case .ignore(let why?) = input.line(Self.startLine) else { Issue.record("expected ignore"); return }
        #expect(why.contains("start"))
        guard case .ignore(let why2?) = input.line("nope") else { Issue.record("expected ignore"); return }
        #expect(why2.contains("invalid"))
    }
}

@Suite struct ParentWatchTests {
    @Test func unchangedParentIsNotOrphaned() {
        #expect(!ParentWatch.isOrphaned(originalParent: 4242, currentParent: 4242))
    }

    @Test func reparentedToLaunchdIsOrphaned() {
        #expect(ParentWatch.isOrphaned(originalParent: 4242, currentParent: 1))
    }

    @Test func anyParentChangeIsOrphaned() {
        #expect(ParentWatch.isOrphaned(originalParent: 4242, currentParent: 777))
    }

    @Test func launchedByLaunchdIsNotOrphaned() {
        #expect(!ParentWatch.isOrphaned(originalParent: 1, currentParent: 1))
    }
}

@Suite struct PermissionsReportTests {
    @Test func encodesContractCLine() {
        let r = PermissionsReport(screenRecording: true, postEvent: false,
                                  macos: PermissionsReport.versionString(major: 14, minor: 5, patch: 0))
        #expect(r.jsonLine() == #"{"macos":"14.5.0","postEvent":false,"screenRecording":true}"#)
    }

    @Test func versionStringKeepsAllThreeComponents() {
        #expect(PermissionsReport.versionString(major: 26, minor: 0, patch: 1) == "26.0.1")
    }
}
