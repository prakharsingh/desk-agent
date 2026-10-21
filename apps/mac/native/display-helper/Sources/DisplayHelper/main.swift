import AppKit
import DisplayHelperCore
import DisplayHelperSystem
import Foundation

// A closed stdout/stderr pipe (Electron main quit or crashed) must make writes fail with EPIPE, not
// kill the helper before the display is destroyed. Set first, for every mode.
signal(SIGPIPE, SIG_IGN)

func fail(_ message: String, code: Int32) -> Never {
    Stderr.write(message)
    exit(code)
}

func diag(_ message: String) { Stderr.diag(message) }

/// Contract C stdout: one JSON event per line. stdio (not FileHandle) so a closed pipe returns EPIPE
/// instead of raising (SIGPIPE is ignored by `ProcessLifecycle`). Called only on the session queue.
final class StdoutSink: HelperEventSink {
    /// Runs right after the `ended` line has been written and flushed.
    var onEnded: (() -> Void)?

    func emit(_ event: HelperEvent) {
        fputs(event.jsonLine() + "\n", stdout)
        fflush(stdout)
        if case .ended = event { onEnded?() }
    }
}

/// `serve` mode.
///
/// THREADING RULE: every `SessionController` call happens on `queue`, one serial queue. Socket
/// callbacks (VideoServer and its connections run on it), the 250 ms tick timer, CaptureEncoder
/// callbacks (the encoder is created on it), stdin lines/EOF, the parent-death poll and signal
/// handlers (ProcessLifecycle delivers on it) all arrive there already; nothing else may touch the
/// controller. The main thread only runs the AppKit run loop.
final class ServeMode {
    let queue = DispatchQueue(label: "com.deskagent.display-helper.session")
    private lazy var lifecycle = ProcessLifecycle(queue: queue)
    private let sink = StdoutSink()
    private var input = ServeInput()
    private var controller: SessionController?
    private var backend: RealDisplayBackend?
    private var server: VideoServer?
    private var tickTimer: DispatchSourceTimer?
    private var exiting = false

    /// Installs the watchers; the caller then runs the AppKit run loop.
    func install() {
        // Shut down first, then log: the diagnostic is best-effort (the parent may be gone) and must
        // never stand between us and destroying the display. Before `start`, shutdown exits directly.
        lifecycle.watchSignals { [unowned self] signo in
            self.shutdown(.signal)
            diag("signal \(signo)")
        }
        lifecycle.watchParent { [unowned self] in
            self.shutdown(.parentExit)
            diag("parent process died")
        }
        lifecycle.watchStdin(
            onLine: { [unowned self] line in self.handle(self.input.line(line)) },
            onEOF: { [unowned self] in self.handle(self.input.eof()) })
    }

    private func handle(_ action: ServeInput.Action) {
        switch action {
        case .start(let command):
            startSession(command)
        case .stop(let reason):
            shutdown(reason)
        case .ignore(let why):
            if let why { sink.emit(.log(level: "warn", message: why)) }
        case .usageError(let message):
            fail("usage error: \(message)", code: 2)
        }
    }

    /// Ends the session (destroying the display) and exits once `ended` is written. Before `start`
    /// there is no session and nothing to clean up.
    private func shutdown(_ reason: EndReason) {
        guard let controller else {
            diag("exiting before start (\(reason.rawValue))")
            exit(0)
        }
        controller.stop(reason)
    }

    private func startSession(_ start: StartCommand) {
        let backend = RealDisplayBackend(queue: queue)
        let controller = SessionController(start: start, backend: backend, sink: sink,
                                           now: { ProcessInfo.processInfo.systemUptime })
        self.backend = backend
        self.controller = controller
        sink.onEnded = { [unowned self] in self.finish() }

        // F16: CaptureEncoder → SessionController. The encoder's queue is `queue`, so these already run on it.
        let encoder = backend.encoder
        encoder.shouldEncode = { [weak controller] in controller?.shouldEncodeNextFrame() ?? false }
        encoder.onFrame = { [weak controller] data, keyframe in controller?.encoded(annexB: data, keyframe: keyframe) }
        encoder.onParameterSets = { [weak controller] data, w, h in
            controller?.parameterSets(annexB: data, width: w, height: h)
        }
        encoder.onError = { [weak controller] error in controller?.captureError(error) }

        // Pre-flight: bind the listener BEFORE the display exists; `begin()` runs only once it is
        // listening, so `port-in-use` can never follow `ready` and a busy port never creates a display.
        do {
            let server = try VideoServer(
                port: start.port, queue: queue,
                onReady: { [unowned self] in self.listening() },
                onAccept: { [weak controller] conn in
                    guard let controller else { return conn.close() }
                    let id = controller.accept(conn)
                    conn.onReceive = { [weak controller] data in controller?.receive(data, on: id) }
                    conn.onClose = { [weak controller] in controller?.closed(id) }
                },
                onFailed: { [weak controller] error in
                    // EADDRINUSE is the expected cause; any other listener failure has no better
                    // Contract C reason, so it ends the same way (the log says which it was).
                    let what = VideoServer.isAddressInUse(error) ? "port \(start.port) in use" : "\(error)"
                    controller?.stopWithLog("video listener failed: \(what)", .portInUse)
                })
            self.server = server
            server.start()
        } catch {
            controller.stopWithLog("video listener could not be created: \(error)", .portInUse)
        }
    }

    private func listening() {
        guard let controller, controller.endedReason == nil else { return }
        controller.begin()   // preflight → createDisplay → waitUntilCapturable → `ready`
        guard controller.endedReason == nil else { return }
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + 0.25, repeating: 0.25)
        timer.setEventHandler { [weak controller] in controller?.tick() }
        tickTimer = timer
        timer.resume()
    }

    /// After `ended`: the display is already destroyed. Stop listening, then give the closing socket a
    /// moment to deliver `end{reason}` and its FIN before exiting 0.
    private func finish() {
        guard !exiting else { return }
        exiting = true
        tickTimer?.cancel()
        tickTimer = nil
        server?.stop()
        fflush(stdout)
        queue.asyncAfter(deadline: .now() + 0.2) { exit(0) }
    }
}

extension SessionController {
    func stopWithLog(_ message: String, _ reason: EndReason) {
        diag(message)
        stop(reason)
    }
}

let mode: HelperMode
do {
    mode = try Arguments.parse(Array(CommandLine.arguments.dropFirst()))
} catch let error as UsageError {
    fail("usage error: \(error.message)\nusage: desk-agent-display-helper serve | --check | --request-permissions | --version", code: 2)
} catch {
    fail("usage error: \(error)", code: 2)
}

switch mode {
case .version:
    print("desk-agent-display-helper \(HELPER_VERSION)")
case .check:
    print(Permissions.report().jsonLine())
case .requestPermissions:
    Permissions.request()
    print(Permissions.report().jsonLine())
case .serve:
    // F17: unreachable in practice — Package.swift's deployment target is macOS 14, so dyld refuses to
    // launch on anything older. Kept as the documented Contract C exit code; deliberately untested.
    if !ProcessInfo.processInfo.isOperatingSystemAtLeast(OperatingSystemVersion(majorVersion: 14, minorVersion: 0, patchVersion: 0)) {
        fail("macOS 14 or later is required", code: 3)
    }
    // A real AppKit run loop (no Dock icon, no menu bar) so NSWorkspace sleep/wake and display
    // reconfiguration notifications are delivered later (Tasks 4.3, 5.2). Set up BEFORE the watchers:
    // the stdin thread may deliver `start` (and create the display) as soon as `install()` returns.
    // Session work stays on the serial session queue; the process exits from there after `ended`.
    let app = NSApplication.shared
    app.setActivationPolicy(.prohibited)
    let serve = ServeMode()
    serve.install()
    app.run()
}
