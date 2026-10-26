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
    /// Mode activation found the display in a macOS mirror set (a saved "Entire Screen" choice) before any
    /// configuration call, and configured nothing. At start the identity is dropped like an offline one;
    /// after `ready` the display keeps its current mode. Never ends a session by itself. Carries the
    /// queries that fired (`MirrorVerdict.mirrored`).
    case displayMirrored(String)

    /// The error `waitUntilCapturable` reports when its timeout expires.
    public static func capturableTimeout(everOnline: Bool) -> BackendError {
        everOnline ? .captureUnavailable : .unsupported
    }
}
