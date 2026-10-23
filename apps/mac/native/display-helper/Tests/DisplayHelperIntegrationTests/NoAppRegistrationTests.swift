import Foundation
import Testing

/// F-O4: `serve` runs an AppKit app object, which checks the process in with LaunchServices under its
/// main bundle. Shipped in `Desk Agent.app/Contents/MacOS` its main bundle was Desk Agent.app, so it
/// registered as a second "Desk Agent" (`com.deskagent.mac`), and `quit app "Desk Agent"` went to the
/// helper: it exited (ending the session) while Desk Agent kept running. The helper now ships in
/// `Contents/Helpers` (apps/mac/package.json `extraFiles`, `displayHelperPath()` in index.ts).
///
/// These tests copy the built helper into a throwaway bundle with its own made-up bundle id (never
/// Desk Agent's), run `serve` there and check what LaunchServices made of it. No `start` is sent, so no
/// display is created and no permission is touched.
@Suite(.serialized) struct NoAppRegistrationTests {
    /// The shipped location: no bundle identity, and an AppleScript Quit aimed at the bundle's id
    /// cannot reach the helper.
    @Test func helperInContentsHelpersDoesNotTakeTheBundlesIdentityOrItsQuit() throws {
        try withHelper(in: "Helpers") { pid, bundleId, isRunning in
            let info = try lsappinfoBundleId(pid: pid)
            #expect(!info.contains(bundleId), "helper registered as the app bundle: \(info)")
            let quit = osascriptQuit(bundleId: bundleId)
            Thread.sleep(forTimeInterval: 1.0)
            #expect(isRunning(), "helper exited on `quit` aimed at the app (osascript: \(quit))")
        }
    }

    /// Control: the old `Contents/MacOS` location reproduces F-O4 (registration as the app, and the
    /// AppleScript Quit kills the helper). If this ever stops failing the way F-O4 did, the test above
    /// no longer proves anything.
    @Test func helperInContentsMacOSTakesTheBundlesIdentityAndItsQuit() throws {
        try withHelper(in: "MacOS") { pid, bundleId, isRunning in
            let info = try lsappinfoBundleId(pid: pid)
            #expect(info.contains(bundleId), "expected the F-O4 registration, got: \(info)")
            _ = osascriptQuit(bundleId: bundleId)
            Thread.sleep(forTimeInterval: 1.0)
            #expect(!isRunning(), "expected the quit to reach the helper")
        }
    }
}

/// Builds `<tmp>/Probe.app` with the helper at `Contents/<dir>/`, runs `serve` (stdin held open), waits
/// for its app object to check in, then runs `body`. Cleans up the process and the bundle.
private func withHelper(in dir: String, _ body: (Int32, String, () -> Bool) throws -> Void) throws {
    let bin = try #require(helperBinary(), "desk-agent-display-helper not built next to the tests")
    let fm = FileManager.default
    let root = fm.temporaryDirectory.appendingPathComponent("da-quit-probe-\(UUID().uuidString)")
    defer { try? fm.removeItem(at: root) }
    let bundleId = "com.deskagent.test.quit-probe.\(UUID().uuidString.prefix(8).lowercased())"
    let contents = root.appendingPathComponent("Probe.app/Contents")
    try fm.createDirectory(at: contents.appendingPathComponent(dir), withIntermediateDirectories: true)
    let plist: [String: Any] = [
        "CFBundleIdentifier": bundleId, "CFBundleName": "DeskAgentQuitProbe",
        "CFBundleExecutable": "DeskAgentQuitProbe", "CFBundlePackageType": "APPL",
    ]
    try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0)
        .write(to: contents.appendingPathComponent("Info.plist"))
    let helper = contents.appendingPathComponent("\(dir)/desk-agent-display-helper")
    try fm.copyItem(at: bin, to: helper)

    let p = Process()
    p.executableURL = helper
    p.arguments = ["serve"]
    p.standardOutput = FileHandle.nullDevice
    p.standardError = FileHandle.nullDevice
    let stdin = Pipe()
    p.standardInput = stdin
    try p.run()
    defer {
        try? stdin.fileHandleForWriting.close()
        if p.isRunning { p.terminate() }
        p.waitUntilExit()
    }
    // Wait for the check-in (milliseconds after launch) so the assertions are not racing it.
    let deadline = Date().addingTimeInterval(5)
    while p.isRunning, Date() < deadline, (try? lsappinfoBundleId(pid: p.processIdentifier))?.isEmpty ?? true {
        Thread.sleep(forTimeInterval: 0.05)
    }
    Thread.sleep(forTimeInterval: 0.3)
    try #require(p.isRunning, "serve exited before the quit was sent")
    try body(p.processIdentifier, bundleId, { p.isRunning })
}

/// `lsappinfo info -only bundleid <pid>`: e.g. `"CFBundleIdentifier"="com.x"`, `…=[ NULL ]`, or "".
private func lsappinfoBundleId(pid: Int32) throws -> String {
    try run("/usr/bin/lsappinfo", ["info", "-only", "bundleid", "\(pid)"])
}

/// `osascript -e 'tell application id "<id>" to quit'`, as `quit app "Desk Agent"` resolves it. Aimed
/// at the throwaway bundle id, so it can never reach a running Desk Agent. Returns osascript's output.
@discardableResult
private func osascriptQuit(bundleId: String) -> String {
    (try? run("/usr/bin/osascript", ["-e", "with timeout of 5 seconds",
                                     "-e", "tell application id \"\(bundleId)\" to quit",
                                     "-e", "end timeout"])) ?? "osascript failed to run"
}

private func run(_ tool: String, _ args: [String]) throws -> String {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: tool)
    p.arguments = args
    let out = Pipe()
    p.standardOutput = out
    p.standardError = out
    try p.run()
    let data = out.fileHandleForReading.readDataToEndOfFile()
    p.waitUntilExit()
    return String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
}
