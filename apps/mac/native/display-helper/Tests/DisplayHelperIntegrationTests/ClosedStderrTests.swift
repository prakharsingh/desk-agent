import Foundation
import Testing

/// The built `desk-agent-display-helper` next to the test bundle (`swift test` builds every product).
private func helperBinary() -> URL? {
    let name = "desk-agent-display-helper"
    var dirs = (Bundle.allBundles + [Bundle.main]).map { $0.bundleURL.deletingLastPathComponent() }
    // Fallback: <package>/.build/debug (this file is <package>/Tests/<target>/<file>).
    let package = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent()
    dirs.append(package.appendingPathComponent(".build/debug"))
    return dirs.map { $0.appendingPathComponent(name) }.first { FileManager.default.isExecutableFile(atPath: $0.path) }
}

/// Runs the helper with its stderr connected to a pipe whose read end is already closed (Electron main
/// died), feeds `stdin`, and returns how it ended.
private func runWithClosedStderr(_ args: [String], stdin input: String?,
                                  sigtermAfter delay: TimeInterval? = nil) throws -> (reason: Process.TerminationReason, status: Int32) {
    let bin = try #require(helperBinary(), "desk-agent-display-helper not built next to the tests")
    let p = Process()
    p.executableURL = bin
    p.arguments = args
    let err = Pipe()
    try err.fileHandleForReading.close()   // no reader: every stderr write now fails with EPIPE
    p.standardError = err
    p.standardOutput = FileHandle.nullDevice
    let inPipe = Pipe()
    p.standardInput = inPipe
    try p.run()
    if let input { inPipe.fileHandleForWriting.write(Data(input.utf8)) }
    if let delay {
        // Keep stdin open; let `serve` install its signal sources, then SIGTERM it.
        Thread.sleep(forTimeInterval: delay)
        p.terminate()
    }
    try inPipe.fileHandleForWriting.close()
    let deadline = Date().addingTimeInterval(10)
    while p.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.02) }
    if p.isRunning { p.terminate(); Issue.record("helper did not exit within 10 s") }
    p.waitUntilExit()
    return (p.terminationReason, p.terminationStatus)
}

/// I1 (Checkpoint 1): a stderr diagnostic written after the parent closed its end of the pipe must not
/// abort the helper (legacy `FileHandle.write` raises → SIGABRT, exit 134). No display, no permissions.
@Suite struct ClosedStderrTests {
    @Test func eofBeforeStartFailsWithExit2() throws {
        // stdin EOF before `start` → fail("usage error: stdin closed before a start command", code: 2).
        let r = try runWithClosedStderr(["serve"], stdin: nil)
        #expect(r.reason == .exit, "helper died of signal \(r.status)")
        #expect(r.status == 2)
    }

    @Test func sigtermBeforeStartExitsZero() throws {
        // SIGTERM → shutdown(.signal) (exit 0 before `start`) — no diagnostic may abort it first.
        let r = try runWithClosedStderr(["serve"], stdin: nil, sigtermAfter: 1.5)
        #expect(r.reason == .exit, "helper died of signal \(r.status)")
        #expect(r.status == 0)
    }

    @Test func badFirstLineFailsWithExit2() throws {
        // A bad first line → fail("usage error…", code: 2).
        let r = try runWithClosedStderr(["serve"], stdin: "not json\n")
        #expect(r.reason == .exit, "helper died of signal \(r.status)")
        #expect(r.status == 2)
    }

    @Test func badArgumentsFailWithExit2() throws {
        // Argument usage errors happen before `serve` ignores SIGPIPE.
        let r = try runWithClosedStderr(["--bogus"], stdin: nil)
        #expect(r.reason == .exit, "helper died of signal \(r.status)")
        #expect(r.status == 2)
    }
}
