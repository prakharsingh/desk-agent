import CoreGraphics

public struct ModeSpec: Equatable {
    public let widthPoints: Int
    public let heightPoints: Int

    public init(widthPoints: Int, heightPoints: Int) {
        self.widthPoints = widthPoints
        self.heightPoints = heightPoints
    }
}

public enum DisplayModes {
    /// Pixel-to-point divisors, in the order alternatives are offered.
    public static let divisors: [Double] = [2.5, 3.0, 2.0, 1.5, 1.0]

    /// Physical size reported to macOS. With `dpi`, px / dpi * 25.4 per axis;
    /// without, the OnePlus 6T panel (145x67 landscape, swapped for portrait).
    public static func sizeInMillimeters(surfaceW: Int, surfaceH: Int, dpi: Double?) -> CGSize {
        if let dpi, dpi > 0 {
            return CGSize(width: Double(surfaceW) / dpi * 25.4, height: Double(surfaceH) / dpi * 25.4)
        }
        return surfaceW >= surfaceH ? CGSize(width: 145, height: 67) : CGSize(width: 67, height: 145)
    }

    /// Point sizes for each divisor, rounded down to even; `preferredDivisor` first,
    /// the rest in `divisors` order.
    public static func modes(surfaceW: Int, surfaceH: Int, preferredDivisor: Double = 2.5) -> [ModeSpec] {
        func even(_ v: Double) -> Int { Int(v.rounded(.down)) & ~1 }
        func spec(_ d: Double) -> ModeSpec {
            ModeSpec(widthPoints: even(Double(surfaceW) / d), heightPoints: even(Double(surfaceH) / d))
        }
        let rest = divisors.filter { $0 != preferredDivisor }
        return ([preferredDivisor] + rest).map(spec)
    }

    /// Descriptor max size is fixed for the display's lifetime, so reserve room for
    /// both orientations: min(8192, 2 * longest side).
    public static func descriptorMaxPixels(surfaceW: Int, surfaceH: Int) -> Int {
        min(8192, 2 * max(surfaceW, surfaceH))
    }

    /// The entry of `divisors` closest to surfaceW / currentWidthPoints.
    public static func nearestDivisor(currentWidthPoints: Int, surfaceW: Int) -> Double {
        guard currentWidthPoints > 0 else { return divisors[0] }
        let ratio = Double(surfaceW) / Double(currentWidthPoints)
        return divisors.min { abs($0 - ratio) < abs($1 - ratio) } ?? divisors[0]
    }
}
