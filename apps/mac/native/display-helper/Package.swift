// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "DeskAgentDisplayHelper",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "desk-agent-display-helper", targets: ["DisplayHelper"]),
    ],
    targets: [
        .target(
            name: "CVirtualDisplay",
            linkerSettings: [.linkedFramework("CoreGraphics")]
        ),
        .target(name: "DisplayHelperCore"),
        .target(
            name: "DisplayHelperSystem",
            dependencies: ["CVirtualDisplay", "DisplayHelperCore"],
            swiftSettings: [.swiftLanguageMode(.v5)],
            linkerSettings: [
                .linkedFramework("ScreenCaptureKit"),
                .linkedFramework("VideoToolbox"),
                .linkedFramework("CoreMedia"),
                .linkedFramework("Network"),
                .linkedFramework("AppKit"),
            ]
        ),
        .executableTarget(
            name: "DisplayHelper",
            dependencies: ["DisplayHelperCore", "DisplayHelperSystem"],
            swiftSettings: [.swiftLanguageMode(.v5)]
        ),
        .testTarget(
            name: "DisplayHelperCoreTests",
            dependencies: ["DisplayHelperCore"]
        ),
        // Opt-in integration tests (real displays / permissions). Placeholder until Task 1.4.
        .testTarget(
            name: "DisplayHelperIntegrationTests",
            dependencies: ["DisplayHelperSystem"]
        ),
    ]
)
