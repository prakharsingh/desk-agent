import Foundation

public let HELPER_VERSION = "0.1.0"

public enum HelperMode: Equatable {
    case version, check, requestPermissions, serve
}

public struct UsageError: Error, Equatable {
    public let message: String
    public init(_ message: String) { self.message = message }
}

public enum Arguments {
    /// `argv` excludes the program name.
    public static func parse(_ argv: [String]) throws -> HelperMode {
        guard let first = argv.first else { throw UsageError("missing mode") }
        guard argv.count == 1 else { throw UsageError("unexpected extra arguments") }
        switch first {
        case "serve": return .serve
        case "--check": return .check
        case "--request-permissions": return .requestPermissions
        case "--version": return .version
        default: throw UsageError("unknown argument: \(first)")
        }
    }
}
