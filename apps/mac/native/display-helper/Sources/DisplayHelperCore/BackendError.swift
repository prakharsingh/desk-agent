/// Why the capture backend could not start or keep running (maps to Contract C `ended` reasons).
public enum BackendError: Error, Equatable {
    /// The virtual display never joined `CGGetOnlineDisplayList` → `unsupported`.
    case unsupported
    /// Online, but never listed in `SCShareableContent` (usually Screen Recording) → `capture-unavailable`.
    case captureUnavailable
    /// ScreenCaptureKit reported `userDeclined` → `permission-screen-recording`.
    case permissionDenied
    /// The stream / encoder failed after starting → `capture-failed`.
    case captureFailed(String)
    /// The virtual display stayed offline for 1 s in a row during mode activation → `display-offline`
    /// (after the spare identity, `DisplayIdentity`, was offline too).
    case displayOffline

    /// The error `waitUntilCapturable` reports when its timeout expires.
    public static func capturableTimeout(everOnline: Bool) -> BackendError {
        everOnline ? .captureUnavailable : .unsupported
    }
}
