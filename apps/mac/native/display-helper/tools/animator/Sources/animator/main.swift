// Dev tool for the opt-in capture probe (DESK_AGENT_CAPTURE_PROBE=1): ScreenCaptureKit only delivers
// frames when content changes, so this waits (up to 60 s) for the Desk Agent virtual display
// (vendor 0x3456), opens a borderless window ON it and flips it red/blue at ~30 Hz for
// `duration` seconds (default 12), then exits 0 (1 if the display never appeared).
//
//   swift run --package-path tools/animator animator [duration-seconds]
//
// NSWindow's contentRect is relative to the `screen:` it is created on, NOT global coordinates;
// passing the screen's global frame puts the window off-screen (Checkpoint 1 live finding).
import AppKit
import CoreGraphics

let vendorId: UInt32 = 0x3456
let duration = CommandLine.arguments.dropFirst().first.flatMap(Double.init) ?? 12

func findDisplay() -> CGDirectDisplayID? {
    var ids = [CGDirectDisplayID](repeating: 0, count: 32)
    var n: UInt32 = 0
    CGGetOnlineDisplayList(32, &ids, &n)
    return ids.prefix(Int(n)).first { CGDisplayVendorNumber($0) == vendorId }
}

func screen(for id: CGDirectDisplayID) -> NSScreen? {
    NSScreen.screens.first {
        ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value == id
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let start = Date()
var window: NSWindow?
var shownAt: Date?
var flip = false

Timer.scheduledTimer(withTimeInterval: 1.0 / 30.0, repeats: true) { _ in
    guard let w = window else {
        if Date().timeIntervalSince(start) > 60 { print("animator: no display"); exit(1) }
        guard let id = findDisplay(), let screen = screen(for: id) else { return }
        // Screen-relative: a 100 pt inset inside the target screen.
        let rect = NSRect(x: 100, y: 100, width: screen.frame.width - 200, height: screen.frame.height - 200)
        let w = NSWindow(contentRect: rect, styleMask: [.borderless], backing: .buffered, defer: false, screen: screen)
        w.level = .floating
        w.orderFrontRegardless()
        window = w
        shownAt = Date()
        print("animator: window on display \(id) screen \(screen.frame) window \(w.frame)")
        fflush(stdout)
        return
    }
    flip.toggle()
    w.backgroundColor = flip ? .systemRed : .systemBlue
    w.display()
    if let s = shownAt, Date().timeIntervalSince(s) > duration {
        w.close()
        print("animator: done")
        exit(0)
    }
}
app.run()
