import CoreGraphics
import DisplayHelperCore
import Foundation

/// The Screen Recording TCC calls, injectable so tests can prove which ones a code path makes.
public struct ScreenCaptureAccess {
    /// `CGPreflightScreenCaptureAccess`: no prompt.
    public var preflight: () -> Bool
    /// `CGRequestScreenCaptureAccess`: may show the system prompt. Only `--request-permissions` calls it.
    public var request: () -> Bool

    public init(preflight: @escaping () -> Bool, request: @escaping () -> Bool) {
        self.preflight = preflight
        self.request = request
    }

    public static let system = ScreenCaptureAccess(preflight: { CGPreflightScreenCaptureAccess() },
                                                   request: { CGRequestScreenCaptureAccess() })
}

/// TCC status for the two permissions the helper needs. In dev the answers reflect the *terminal's*
/// grants (the responsible process); when spawned by Desk Agent they reflect Desk Agent's.
public enum Permissions {
    public static func check() -> (screenRecording: Bool, postEvent: Bool) {
        (ScreenCaptureAccess.system.preflight(), CGPreflightPostEventAccess())
    }

    /// Shows the system prompts / adds the Settings entries for anything not yet granted.
    @discardableResult
    public static func request() -> (screenRecording: Bool, postEvent: Bool) {
        (ScreenCaptureAccess.system.request(), CGRequestPostEventAccess())
    }

    public static func macOSVersion() -> String {
        let v = ProcessInfo.processInfo.operatingSystemVersion
        return PermissionsReport.versionString(major: v.majorVersion, minor: v.minorVersion, patch: v.patchVersion)
    }

    /// The Contract C `--check` line.
    public static func report() -> PermissionsReport {
        let c = check()
        return PermissionsReport(screenRecording: c.screenRecording, postEvent: c.postEvent, macos: macOSVersion())
    }
}
