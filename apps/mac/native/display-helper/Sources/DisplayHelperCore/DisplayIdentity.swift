/// The vendor/product/serial identity macOS keys a display's persisted state on (arrangement, scale,
/// and Control Center's "independent output" that keeps it switched off).
///
/// Each phone has a stable primary serial (main's `stableDisplaySerial`). When macOS keeps that
/// identity switched off, a session retries once with the phone's *spare* serial: a fixed function of
/// the primary, so the spare keeps its own arrangement and scale across sessions. Sessions always try
/// the primary first, so the user's original arrangement wins again once it is switched back on.
public enum DisplayIdentity {
    /// XORed into the primary. Never 0 or 1, so the spare always differs from the primary.
    public static let spareMask: UInt32 = 0x5350_4152   // "SPAR"

    /// The serial `VirtualDisplayController` actually registers: it turns 0 into 1.
    static func effective(_ serial: UInt32) -> UInt32 { serial == 0 ? 1 : serial }

    /// Deterministic, never 0 and never equal to the primary's effective serial.
    public static func spareSerial(for primary: UInt32) -> UInt32 {
        let spare = effective(primary) ^ spareMask
        return spare == 0 ? 1 : spare
    }
}
