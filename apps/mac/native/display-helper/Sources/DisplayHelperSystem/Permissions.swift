import CoreGraphics
import DisplayHelperCore
import Foundation

/// TCC status for the two permissions the helper needs. In dev the answers reflect the *terminal's*
/// grants (the responsible process); when spawned by Desk Agent they reflect Desk Agent's.
public enum Permissions {
    public static func check() -> (screenRecording: Bool, postEvent: Bool) {
        (CGPreflightScreenCaptureAccess(), CGPreflightPostEventAccess())
    }

    /// Shows the system prompts / adds the Settings entries for anything not yet granted.
    @discardableResult
    public static func request() -> (screenRecording: Bool, postEvent: Bool) {
        (CGRequestScreenCaptureAccess(), CGRequestPostEventAccess())
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
