import DisplayHelperCore
import Foundation

/// Process-level plumbing for `serve`: stdin lines/EOF, parent-death polling and signals.
/// Every callback is delivered on `queue` (the serial session queue).
public final class ProcessLifecycle {
    private let queue: DispatchQueue
    private var parentTimer: DispatchSourceTimer?
    private var signalSources: [DispatchSourceSignal] = []

    public init(queue: DispatchQueue) {
        self.queue = queue
        // A dead parent closes our stdout pipe; a write must fail with EPIPE, not kill us before the
        // display is destroyed.
        signal(SIGPIPE, SIG_IGN)
    }

    /// Reads fd 0 on a dedicated thread; lines and the single EOF are hopped onto `queue`.
    public func watchStdin(onLine: @escaping (String) -> Void, onEOF: @escaping () -> Void) {
        let queue = self.queue
        let thread = Thread {
            var splitter = LineSplitter()
            var buf = [UInt8](repeating: 0, count: 4096)
            while true {
                let n = read(STDIN_FILENO, &buf, buf.count)
                if n < 0 && errno == EINTR { continue }
                if n <= 0 { break }
                for line in splitter.append(Data(buf[0..<n])) { queue.async { onLine(line) } }
            }
            if let tail = splitter.finish() { queue.async { onLine(tail) } }
            queue.async { onEOF() }
        }
        thread.name = "display-helper.stdin"
        thread.start()
    }

    /// Polls `getppid()` every second; fires once when it changes (normally to 1 = launchd).
    public func watchParent(onOrphaned: @escaping () -> Void) {
        let original = getppid()
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + 1, repeating: 1)
        timer.setEventHandler { [weak self] in
            guard ParentWatch.isOrphaned(originalParent: original, currentParent: getppid()) else { return }
            self?.parentTimer?.cancel()
            self?.parentTimer = nil
            onOrphaned()
        }
        parentTimer = timer
        timer.resume()
    }

    /// SIGTERM / SIGINT / SIGHUP → `onSignal(signo)` on `queue` (default actions disabled).
    public func watchSignals(onSignal: @escaping (Int32) -> Void) {
        for signo in [SIGTERM, SIGINT, SIGHUP] {
            signal(signo, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: signo, queue: queue)
            source.setEventHandler { onSignal(signo) }
            source.resume()
            signalSources.append(source)
        }
    }
}
