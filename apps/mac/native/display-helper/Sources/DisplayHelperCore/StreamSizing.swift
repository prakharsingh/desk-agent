public enum StreamSizing {
    /// Largest size within maxW x maxH that preserves the surface aspect ratio
    /// (never upscaled), with both dimensions even.
    public static func streamSize(surfaceW: Int, surfaceH: Int, maxW: Int, maxH: Int) -> (w: Int, h: Int) {
        guard surfaceW > 0, surfaceH > 0 else { return (w: 0, h: 0) }
        let scale = min(1.0, Double(maxW) / Double(surfaceW), Double(maxH) / Double(surfaceH))
        let w = max(2, Int((Double(surfaceW) * scale).rounded(.down)) & ~1)
        let h = max(2, Int((Double(surfaceH) * scale).rounded(.down)) & ~1)
        return (w: w, h: h)
    }
}
