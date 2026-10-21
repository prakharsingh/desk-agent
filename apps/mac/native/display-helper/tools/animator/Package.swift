// swift-tools-version:6.0
// Dev-only test-window animator for the capture probe; not part of the shipped helper.
import PackageDescription

let package = Package(
    name: "DeskAgentAnimator",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(name: "animator", swiftSettings: [.swiftLanguageMode(.v5)]),
    ]
)
