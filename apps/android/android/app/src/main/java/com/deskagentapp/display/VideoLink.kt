package com.deskagentapp.display

import android.os.SystemClock
import android.util.Log
import java.io.BufferedInputStream
import java.io.DataInputStream
import java.io.IOException
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.TimeUnit
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/**
 * The phone's end of the Contract D video socket (127.0.0.1:8788 via `adb reverse`).
 *
 * Threads: [open] connects and writes `hello` on the caller's thread, then starts three
 * daemon threads: a reader (frames -> [Listener.onFrame]), a keepalive writer, and a
 * watchdog that never writes (so a write blocked on a full send buffer cannot park it;
 * its close closes the socket, which unblocks any blocked writer).
 * Every way the link can end — [close], a helper EOF/IOException, a protocol violation,
 * a failed write, the watchdog — funnels through [close], so [Listener.onClosed] fires
 * exactly once, from whichever thread ended it, after the link threads have stopped
 * (bounded join; never joins the calling thread).
 */
class VideoLink(
    private val port: Int,
    private val listener: Listener,
    private val clock: () -> Long = { SystemClock.elapsedRealtime() },
    private val keepaliveMs: Long = 1000,
    private val watchdogActiveMs: Long = 2000,
    private val watchdogPausedMs: Long = 10000,
    private val host: String = "127.0.0.1",
) {
    /**
     * Both callbacks run on VideoLink's own threads (or on the thread that called [close],
     * [send] or [open]). [onClosed] may run nested inside [onFrame] (when the listener closes
     * from it) or concurrently with an in-flight [onFrame] on the reader thread: consumers
     * must serialize, e.g. by posting both onto one handler.
     */
    interface Listener {
        fun onFrame(frame: WireFrame)
        fun onClosed(reason: String)
    }

    private val stateLock = Any()
    private val writeLock = Any()
    private val timerLock = ReentrantLock()
    private val timerWake = timerLock.newCondition()

    @Volatile private var closed = false
    @Volatile private var opened = false
    @Volatile private var socket: Socket? = null
    @Volatile private var output: OutputStream? = null
    @Volatile private var reader: Thread? = null
    @Volatile private var keepalive: Thread? = null
    @Volatile private var watchdog: Thread? = null
    @Volatile private var paused = false
    /** Raised by `helloAck`: lifts the outbound cap from 4096 to 65_536 (Contract D). */
    @Volatile private var authenticated = false
    @Volatile private var lastValidFrameAt = 0L

    internal val socketForTest: Socket? get() = socket
    internal fun threadsForTest(): List<Thread> = listOfNotNull(reader, keepalive, watchdog)

    /**
     * Blocking connect (≤ [CONNECT_TIMEOUT_MS]) and hello write; call off the main thread.
     * Call at most once. A connect failure reports `connect-failed` via [Listener.onClosed]
     * on this thread before returning.
     */
    fun open(helloJson: String) {
        val s = Socket()
        synchronized(stateLock) {
            check(!opened) { "VideoLink.open called twice" }
            opened = true
            if (closed) return
            socket = s
        }
        val out: OutputStream
        try {
            s.tcpNoDelay = true
            s.connect(InetSocketAddress(host, port), CONNECT_TIMEOUT_MS)
            out = s.getOutputStream()
        } catch (e: IOException) {
            Log.w(TAG, "video link connect to $host:$port failed: ${e.message}")
            close(REASON_CONNECT_FAILED)
            return
        }
        lastValidFrameAt = clock()
        // hello is the first frame: send() is a no-op until `output` is published below.
        if (!write(helloJson, out)) return
        output = out
        synchronized(stateLock) {
            if (closed) return
            val input = DataInputStream(BufferedInputStream(s.getInputStream()))
            val r = Thread({ guarded { readLoop(input) } }, "display-link-reader")
            val k = Thread({ guarded { keepaliveLoop() } }, "display-link-keepalive")
            val w = Thread({ guarded { watchdogLoop() } }, "display-link-watchdog")
            reader = r; keepalive = k; watchdog = w
            for (t in listOf(r, k, w)) { t.isDaemon = true; t.start() }
        }
    }

    /**
     * Thread-safe; call off the main thread (it writes to the socket and may block while the
     * send buffer is full). Returns false — and sends nothing — before [open] has written
     * `hello`, after close, or when [json] exceeds Contract D's phone→helper cap (4096 bytes
     * before `helloAck`, 65_536 after), which closes the link with `protocol-error`. A failed
     * write closes with `link-lost`. Either close may invoke [Listener.onClosed] re-entrantly
     * on this thread.
     */
    fun send(json: String): Boolean = write(json)

    fun setPaused(paused: Boolean) {
        timerLock.withLock {
            this.paused = paused
            timerWake.signalAll()
        }
    }

    /**
     * Idempotent: the first call wins and reports its [reason] via [Listener.onClosed] on this
     * thread (re-entrantly, if called from a listener callback); later calls return at once.
     * Call off the main thread: it may block up to [JOIN_TIMEOUT_MS] per link thread while
     * joining them (never the calling thread itself).
     */
    fun close(reason: String) {
        val threads: List<Thread>
        synchronized(stateLock) {
            if (closed) return
            closed = true
            threads = listOfNotNull(reader, keepalive, watchdog)
        }
        timerLock.withLock { timerWake.signalAll() }
        try { socket?.close() } catch (_: IOException) {}
        val self = Thread.currentThread()
        for (t in threads) {
            if (t === self) continue
            try {
                t.join(JOIN_TIMEOUT_MS)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
            }
            if (t.isAlive) Log.w(TAG, "video link thread ${t.name} did not stop within $JOIN_TIMEOUT_MS ms")
        }
        Log.i(TAG, "video link closed: $reason")
        listener.onClosed(reason)
    }

    /** @return false if nothing was sent. Enforces Contract D's phone→helper caps. */
    private fun write(json: String, out: OutputStream? = output): Boolean {
        if (closed || out == null) return false
        val frame = try {
            FrameCodec.encodeJson(json)
        } catch (e: Exception) { // handled like a failed write, never propagated to the caller
            Log.e(TAG, "video link encode failed", e)
            close(REASON_LINK_LOST)
            return false
        }
        val len = frame.size - 4
        val cap = if (authenticated) MAX_PHONE_FRAME_LEN else MAX_PHONE_FRAME_LEN_BEFORE_AUTH
        if (len > cap) {
            Log.e(TAG, "outbound frame of $len bytes exceeds the $cap-byte cap")
            close(REASON_PROTOCOL_ERROR)
            return false
        }
        try {
            synchronized(writeLock) {
                if (closed) return false
                out.write(frame)
                out.flush()
            }
        } catch (e: IOException) {
            if (!closed) Log.w(TAG, "video link write failed: ${e.message}")
            close(REASON_LINK_LOST)
            return false
        } catch (e: RuntimeException) { // e.g. NetworkOnMainThreadException
            Log.e(TAG, "video link write failed", e)
            close(REASON_LINK_LOST)
            return false
        }
        return true
    }

    /** Any escape from a link thread's body ends the link instead of killing the thread silently. */
    private inline fun guarded(body: () -> Unit) {
        try {
            body()
        } catch (t: Throwable) {
            if (!closed || t !is IOException) Log.e(TAG, "video link thread ${Thread.currentThread().name} failed", t)
            close(REASON_LINK_LOST)
        }
    }

    private fun readLoop(input: DataInputStream) {
        val reason = try {
            while (!closed) {
                val frame = FrameCodec.read(input)
                if (frame is WireFrame.Json) {
                    val msg = ControlMessages.parse(frame.text)
                    if (msg is HelperMessage.HelloAck) authenticated = true
                }
                // Any valid frame feeds the watchdog — VIDEO or JSON, including an unknown `t`.
                lastValidFrameAt = clock()
                if (closed) break
                listener.onFrame(frame)
            }
            null
        } catch (e: ProtocolException) {
            Log.e(TAG, "video link protocol error: ${e.message}")
            REASON_PROTOCOL_ERROR
        } catch (e: IOException) { // includes EOFException: the helper closed the socket
            if (!closed) Log.w(TAG, "video link lost: ${e.message}")
            REASON_LINK_LOST
        }
        if (reason != null) close(reason)
    }

    /** Sends a keepalive every [keepaliveMs] (also while paused). Never touches the watchdog. */
    private fun keepaliveLoop() {
        var nextKeepalive = clock() + keepaliveMs
        while (true) {
            timerLock.withLock {
                while (!closed) {
                    val now = clock()
                    if (now >= nextKeepalive) break
                    timerWake.await(nextKeepalive - now, TimeUnit.MILLISECONDS)
                }
            }
            if (closed) return
            nextKeepalive += keepaliveMs
            val now = clock()
            if (nextKeepalive <= now) nextKeepalive = now + keepaliveMs // fell behind: don't burst
            if (!write(ControlMessages.keepalive())) return
        }
    }

    /** Closes `link-lost` once no valid frame arrived for the current (active/paused) limit. */
    private fun watchdogLoop() {
        var firedLimit = -1L
        timerLock.withLock {
            while (!closed) {
                val now = clock()
                val limit = if (paused) watchdogPausedMs else watchdogActiveMs
                val deadline = lastValidFrameAt + limit
                if (now >= deadline) { firedLimit = limit; break }
                timerWake.await(deadline - now, TimeUnit.MILLISECONDS)
            }
        }
        if (firedLimit < 0) return
        Log.w(TAG, "video link watchdog: no frame for $firedLimit ms")
        close(REASON_LINK_LOST)
    }

    companion object {
        private const val TAG = "DeskAgentDisplay"
        const val CONNECT_TIMEOUT_MS = 2000
        const val JOIN_TIMEOUT_MS = 2000L
        const val MAX_PHONE_FRAME_LEN_BEFORE_AUTH = 4096
        const val MAX_PHONE_FRAME_LEN = 65_536
        const val REASON_CONNECT_FAILED = "connect-failed"
        const val REASON_PROTOCOL_ERROR = "protocol-error"
        const val REASON_LINK_LOST = "link-lost"
    }
}
