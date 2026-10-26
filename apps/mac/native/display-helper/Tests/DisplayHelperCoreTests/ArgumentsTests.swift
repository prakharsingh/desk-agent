import Testing
@testable import DisplayHelperCore

@Suite struct ArgumentsTests {
    @Test func parsesModes() throws {
        #expect(try Arguments.parse(["serve"]) == .serve)
        #expect(try Arguments.parse(["--check"]) == .check)
        #expect(try Arguments.parse(["--request-permissions"]) == .requestPermissions)
        #expect(try Arguments.parse(["--version"]) == .version)
    }

    @Test func rejectsUnknownAndEmpty() {
        #expect(throws: UsageError.self) { try Arguments.parse([]) }
        #expect(throws: UsageError.self) { try Arguments.parse(["--bogus"]) }
    }
}
