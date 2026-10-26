import Darwin

/// The one stderr writer for every diagnostic in the helper.
///
/// Never traps: it uses write(2) and ignores every error. Electron main may have closed the read end
/// of our stderr pipe (quit/crash), and the legacy `FileHandle.write(_:)` raises an ObjC exception on
/// EPIPE (SIGABRT, exit 134). A lost diagnostic is fine; aborting before the display is destroyed is not.
/// Callers must ignore SIGPIPE (main.swift does at startup) so the failed write returns EPIPE instead
/// of killing the process.
public enum Stderr {
    /// Writes `message` + "\n" verbatim.
    public static func write(_ message: String) {
        let bytes = Array((message + "\n").utf8)
        var offset = 0
        while offset < bytes.count {
            let n = bytes.withUnsafeBytes { buf in
                Darwin.write(STDERR_FILENO, buf.baseAddress! + offset, buf.count - offset)
            }
            if n > 0 { offset += n; continue }
            if n < 0 && errno == EINTR { continue }
            return   // EPIPE, EBADF, …: drop the diagnostic
        }
    }

    /// A `[display-helper] …` diagnostic line.
    public static func diag(_ message: String) {
        write("[display-helper] \(message)")
    }
}
