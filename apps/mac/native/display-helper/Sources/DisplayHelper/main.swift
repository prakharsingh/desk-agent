import Foundation
import DisplayHelperCore
import DisplayHelperSystem

func fail(_ message: String, code: Int32) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(code)
}

do {
    switch try Arguments.parse(Array(CommandLine.arguments.dropFirst())) {
    case .version:
        print("desk-agent-display-helper \(HELPER_VERSION)")
    case .check, .requestPermissions, .serve:
        fail("not implemented", code: 2)  // until Task 1.7
    }
} catch let error as UsageError {
    fail("usage error: \(error.message)\nusage: desk-agent-display-helper serve | --check | --request-permissions | --version", code: 64)
}
