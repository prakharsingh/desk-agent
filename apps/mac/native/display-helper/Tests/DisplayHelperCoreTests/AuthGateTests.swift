import Testing
@testable import DisplayHelperCore

@Suite struct AuthGateTests {
    func hello(v: Int = 1, token: String = "tok", session: String = "s1", codecs: [String] = ["h264"]) -> Hello {
        Hello(v: v, token: token, sessionId: session, surfaceW: 2340, surfaceH: 1080,
              orientation: .landscape, codecs: codecs, maxW: 4096, maxH: 2304, trackpad: false)
    }

    @Test func tokenCompare() {
        #expect(AuthGate.tokensMatch("abcdef", "abcdef"))
        #expect(!AuthGate.tokensMatch("abcdef", "abcdeg"))
        #expect(!AuthGate.tokensMatch("abcdef", "abcde"))
        #expect(!AuthGate.tokensMatch("", "a"))
        #expect(AuthGate.tokensMatch("", ""))
    }

    @Test func helloVerdicts() {
        #expect(AuthGate.verdict(hello(), token: "tok", sessionId: "s1") == .accepted)
        #expect(AuthGate.verdict(hello(token: "bad"), token: "tok", sessionId: "s1") == .rejected)
        #expect(AuthGate.verdict(hello(session: "other"), token: "tok", sessionId: "s1") == .rejected)
        #expect(AuthGate.verdict(hello(v: 2), token: "tok", sessionId: "s1") == .versionMismatch)
        #expect(AuthGate.verdict(hello(v: 2, token: "bad"), token: "tok", sessionId: "s1") == .rejected)
        #expect(AuthGate.verdict(hello(v: 2, session: "x"), token: "tok", sessionId: "s1") == .rejected)
        #expect(AuthGate.verdict(hello(codecs: ["hevc"]), token: "tok", sessionId: "s1") == .rejected)
        #expect(AuthGate.verdict(hello(codecs: []), token: "tok", sessionId: "s1") == .rejected)
    }
}
