import Foundation

public enum HelloVerdict: Equatable, Sendable { case accepted, rejected, versionMismatch }

public enum AuthGate {
    public static let protocolVersion = 1

    /// Constant-time comparison over UTF-8 bytes; false on length mismatch.
    public static func tokensMatch(_ a: String, _ b: String) -> Bool {
        let x = Array(a.utf8), y = Array(b.utf8)
        guard x.count == y.count else { return false }
        var diff: UInt8 = 0
        for i in 0..<x.count { diff |= x[i] ^ y[i] }
        return diff == 0
    }

    /// Token and sessionId are checked FIRST, so an unauthenticated client can never
    /// trigger a version-mismatch response.
    public static func verdict(_ hello: Hello, token: String, sessionId: String) -> HelloVerdict {
        // Evaluate both (no short-circuit) to keep timing independent of which field differs.
        let tokenOK = tokensMatch(hello.token, token)
        let sessionOK = tokensMatch(hello.sessionId, sessionId)
        guard tokenOK && sessionOK else { return .rejected }
        guard hello.v == protocolVersion else { return .versionMismatch }
        guard hello.codecs.contains("h264") else { return .rejected }
        return .accepted
    }
}
