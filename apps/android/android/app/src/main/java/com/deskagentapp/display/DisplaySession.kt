package com.deskagentapp.display

import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.Surface
import java.lang.ref.WeakReference
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Where session events go (the RN module); `emit` may be called from any thread. */
interface DisplayEvents {
    fun emit(name: String, body: Map<String, Any?>)
}

/** What [DisplayModule] drives; implemented by [DisplaySession] (and a fake in tests). */
interface DisplaySessionHost {
    fun nowMs(): Long
    /** Queues [input] for the session thread; never blocks. */
    fun input(input: SessionInput)
    /** [DisplayTokenHolder] got a token for [sessionId]; taken only if that session is awaiting it. */
    fun tokenOffered(sessionId: String)
    fun setEvents(events: DisplayEvents?)
    /** JS just subscribed: re-emit the last surface size, if there is one. */
    fun requestSize()
    /** Queues a recognized gesture; sent only while Streaming with input enabled. Never blocks. */
    fun sendInput(e: SemanticEvent)
    /** Trackpad mode for the recognizer and the helper (`setTrackpad`, and `hello.trackpad`). */
    fun setTrackpadMode(enabled: Boolean)
}

/** The display-session thread. */
interface SessionExecutor {
    fun post(r: Runnable)
    fun postDelayed(r: Runnable, delayMs: Long)
    fun removeCallbacks(r: Runnable)
    fun isCurrentThread(): Boolean
}

class HandlerExecutor(private val handler: Handler) : SessionExecutor {
    override fun post(r: Runnable) { handler.post(r) }
    override fun postDelayed(r: Runnable, delayMs: Long) { handler.postDelayed(r, delayMs) }
    override fun removeCallbacks(r: Runnable) = handler.removeCallbacks(r)
    override fun isCurrentThread(): Boolean = Looper.myLooper() === handler.looper
}

/** The parts of [VideoLink] the session uses. */
interface LinkPort {
    fun open(helloJson: String)
    fun send(json: String): Boolean
    fun close(reason: String)
}

/** The parts of [HardwareDecoder] the session uses. */
interface DecoderPort {
    fun configure(surface: Surface, codec: CodecCandidate, w: Int, h: Int, sps: ByteArray, pps: ByteArray)
    fun queue(annexB: ByteArray, seq: Long): Boolean
    fun release()
    fun stats(): DecoderStats
}

private class VideoLinkPort(private val link: VideoLink) : LinkPort {
    override fun open(helloJson: String) = link.open(helloJson)
    override fun send(json: String): Boolean = link.send(json)
    override fun close(reason: String) = link.close(reason)
}

private class HardwareDecoderPort(private val decoder: HardwareDecoder) : DecoderPort {
    override fun configure(surface: Surface, codec: CodecCandidate, w: Int, h: Int, sps: ByteArray, pps: ByteArray) =
        decoder.configure(surface, codec, w, h, sps, pps)
    override fun queue(annexB: ByteArray, seq: Long): Boolean = decoder.queue(annexB, seq)
    override fun release() = decoder.release()
    override fun stats(): DecoderStats = decoder.stats()
}

/**
 * Runs one [DisplaySessionMachine] and executes its actions. Every machine input and every
 * action runs on [executor] (the "display-session" HandlerThread in production). Callbacks from
 * the video link and the decoder arrive on their own threads and are posted onto it; each link
 * and decoder instance carries a generation number, and callbacks from any instance that is no
 * longer current (superseded, closed, released) are dropped before they reach the machine.
 *
 * The session token is passed straight into `hello` and is never logged.
 */
class DisplaySessionRunner(
    private val executor: SessionExecutor,
    private val clock: () -> Long,
    private val linkFactory: (port: Int, listener: VideoLink.Listener) -> LinkPort,
    private val decoderFactory: (onRendered: (Long) -> Unit, onError: (Throwable) -> Unit) -> DecoderPort,
    private val candidates: () -> List<CodecCandidate>,
) : DisplaySessionHost {
    @Volatile private var events: DisplayEvents? = null
    // Last emitted surface size (w, h, dpi): JS may subscribe after the surface already reported.
    @Volatile private var lastSize: Triple<Int, Int, Float>? = null

    // ---- session-thread state ----
    private val machine = DisplaySessionMachine(TOKEN_WAIT_MS)
    private var link: LinkPort? = null
    private var linkGen = 0
    private var decoder: DecoderPort? = null
    private var decoderGen = 0
    private var codecList: List<CodecCandidate> = emptyList()

    private var surface: Surface? = null
    private var surfaceW = 0
    private var surfaceH = 0

    private var streamW: Int? = null
    private var streamH: Int? = null
    private var configSps: ByteArray? = null
    private var configPps: ByteArray? = null
    private var configW = 0
    private var configH = 0

    private var acker = FrameAcker()
    private var needKeyframe = true
    private var lastVideoSeq = 0L
    /** Highest seq queued successfully into the current decoder instance; 0 = none. */
    private var queuedHighSeq = 0L
    private var lastIdrRequestAt = Long.MIN_VALUE / 2
    private var lastStatsAt = 0L
    private var rendered = 0L
    private var dropped = 0L
    private var decoderErrorsSinceRender = 0
    private val loggedUnknown = HashSet<String>()

    private var ticking = false
    private val tick = Runnable { onTick() }

    /** Requested trackpad mode, and the value the current link's helper was last told. */
    private var trackpad = false
    private var linkTrackpad = false

    /**
     * Called on the session thread each time the session leaves Streaming, so the view can cancel
     * a gesture in progress (a drag then ends locally; the helper also releases the button).
     */
    @Volatile var onStreamingEnded: (() -> Unit)? = null

    internal fun stateForTest(): SessionState = machine.state

    override fun nowMs(): Long = clock()

    override fun input(input: SessionInput) = executor.post { feed(input) }

    override fun tokenOffered(sessionId: String) = executor.post {
        val s = machine.state
        if (s is SessionState.AwaitingToken && s.sessionId == sessionId) {
            DisplayTokenHolder.take(sessionId)?.let { feed(SessionInput.TokenAvailable(sessionId, it)) }
        }
    }

    override fun setEvents(events: DisplayEvents?) { this.events = events }

    override fun sendInput(e: SemanticEvent) = executor.post {
        val st = machine.state
        if (st is SessionState.Streaming && st.inputEnabled) link?.send(ControlMessages.input(e))
    }

    override fun setTrackpadMode(enabled: Boolean) = executor.post {
        trackpad = enabled
        syncTrackpad()
    }

    /**
     * From the SurfaceView (main thread). Fed on every surfaceChanged: a new size on a surface we
     * already hold (rotation; MainActivity keeps the activity via configChanges) is a resize. The
     * decoder is left alone: it keeps decoding the old-size stream (SurfaceView scales it) until
     * the helper's next streamConfig + config frame rebuild it in [onConfig].
     */
    fun surfaceReady(surface: Surface, w: Int, h: Int) = executor.post {
        val resized = this.surface != null && (w != surfaceW || h != surfaceH)
        this.surface = surface
        surfaceW = w
        surfaceH = h
        feed(if (resized) SessionInput.SurfaceResized(w, h) else SessionInput.SurfaceReady(w, h))
    }

    /**
     * From `surfaceDestroyed` (main thread). Waits briefly for the decoder to let go of the
     * surface, since it must not render into it after `surfaceDestroyed` returns. The wait is
     * bounded: the session thread may be inside a blocking VideoLink open/close.
     */
    fun surfaceLost() {
        lastSize = null
        val done = CountDownLatch(1)
        executor.post {
            try {
                surface = null
                // Before the machine's actions: its SendBye/CloseLink can block on the link's
                // thread joins, and the decoder must stop rendering first. The machine's own
                // ReleaseDecoder is then a no-op.
                releaseDecoder()
                feed(SessionInput.SurfaceLost)
            } finally {
                done.countDown()
            }
        }
        if (!executor.isCurrentThread()) {
            try {
                if (!done.await(SURFACE_LOST_WAIT_MS, TimeUnit.MILLISECONDS)) {
                    Log.w(TAG, "surface lost: session thread busy, decoder release still pending")
                }
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
            }
        }
    }

    fun emitSize(w: Int, h: Int, dpi: Float) {
        lastSize = Triple(w, h, dpi)
        events?.emit(EVENT_SIZE, DisplayModule.sizeEventMap(w, h, dpi))
    }

    override fun requestSize() {
        val size = lastSize ?: return
        events?.emit(EVENT_SIZE, DisplayModule.sizeEventMap(size.first, size.second, size.third))
    }

    // ---- everything below runs on the session thread ----

    private fun sessionIdOf(s: SessionState): String? = when (s) {
        is SessionState.AwaitingToken -> s.sessionId
        is SessionState.Connecting -> s.sessionId
        is SessionState.Streaming -> s.sessionId
        else -> null
    }

    private fun feed(input: SessionInput) {
        val before = sessionIdOf(machine.state)
        val wasStreaming = machine.state is SessionState.Streaming
        val actions = machine.handle(input)
        for (a in executionOrder(actions)) execute(a, before)
        if (wasStreaming && machine.state !is SessionState.Streaming) {
            try {
                onStreamingEnded?.invoke()
            } catch (e: Exception) {
                Log.w(TAG, "streaming-ended listener failed: ${e.message}")
            }
        }
        syncTrackpad()
        if (input is SessionInput.Start) {
            // A token that landed after the module's take() but before this Start ran is
            // still held (ClearToken only drops the previous session's token): adopt it.
            val s = machine.state
            if (s is SessionState.AwaitingToken) {
                DisplayTokenHolder.take(s.sessionId)?.let { feed(SessionInput.TokenAvailable(s.sessionId, it)) }
            }
        }
        scheduleTick()
    }

    /**
     * The machine emits SendBye, CloseLink, ReleaseDecoder, ...; the runner releases the decoder
     * first so the codec stops rendering (and its in-flight frames are acked) before
     * VideoLink.close blocks on its thread joins. The machine's emitted order is unchanged.
     */
    private fun executionOrder(actions: List<SessionAction>): List<SessionAction> =
        if (SessionAction.CloseLink in actions && SessionAction.ReleaseDecoder in actions) {
            listOf<SessionAction>(SessionAction.ReleaseDecoder) + actions.filter { it != SessionAction.ReleaseDecoder }
        } else actions

    private fun execute(a: SessionAction, previousSessionId: String?) {
        when (a) {
            is SessionAction.OpenLink -> openLink(a)
            is SessionAction.SendBye -> link?.send(ControlMessages.bye(a.reason))
            is SessionAction.SendResize -> {
                Log.i(TAG, "surface resized to ${a.w}x${a.h}: asking the helper to renegotiate")
                link?.send(ControlMessages.resize(a.w, a.h))
            }
            SessionAction.CloseLink -> closeLink()
            SessionAction.ReleaseDecoder -> releaseDecoder()
            // Idempotent: drops only the ending session's held token (a newer session's token,
            // e.g. one that beat its Start, survives), keeping the holder's repeat guard.
            SessionAction.ClearToken -> previousSessionId?.let { DisplayTokenHolder.take(it) }
            is SessionAction.Emit -> {
                Log.i(TAG, "session ${a.state}" + (a.reason?.let { " ($it)" } ?: ""))
                try {
                    events?.emit(EVENT_STATE, DisplayModule.stateEventMap(a))
                } catch (e: Exception) {
                    Log.w(TAG, "DisplayState emit failed: ${e.message}")
                }
            }
        }
    }

    private fun openLink(a: SessionAction.OpenLink) {
        codecList = try { candidates() } catch (e: Exception) {
            Log.e(TAG, "decoder list unavailable", e); emptyList()
        }
        val codec = DecoderSelector.choose(codecList, surfaceW, surfaceH)
        if (codec == null) {
            Log.e(TAG, "no hardware H.264 decoder for ${surfaceW}x$surfaceH")
            executor.post { feed(SessionInput.DecoderFailed) }
            return
        }
        resetStream()
        acker = FrameAcker()
        rendered = 0; dropped = 0
        lastStatsAt = clock()
        val gen = ++linkGen
        val l = linkFactory(a.port, linkListener(gen))
        link = l
        Log.i(TAG, "opening video link for ${a.sessionId} on port ${a.port} (decoder ${codec.name}, max ${codec.maxW}x${codec.maxH})")
        // Blocks up to VideoLink.CONNECT_TIMEOUT_MS; ticks pause meanwhile (accepted).
        linkTrackpad = trackpad
        l.open(ControlMessages.hello(a.token, a.sessionId, surfaceW, surfaceH, codec.maxW, codec.maxH, trackpad = linkTrackpad))
    }

    /** Tells a streaming helper about a trackpad change made since its hello (or last setTrackpad). */
    private fun syncTrackpad() {
        val l = link ?: return
        if (machine.state !is SessionState.Streaming || linkTrackpad == trackpad) return
        if (l.send(ControlMessages.setTrackpad(trackpad))) linkTrackpad = trackpad
    }

    private fun linkListener(gen: Int) = object : VideoLink.Listener {
        override fun onFrame(frame: WireFrame) = executor.post {
            if (gen == linkGen && link != null) onLinkFrame(frame)
        }

        override fun onClosed(reason: String) = executor.post {
            if (gen == linkGen && link != null) {
                link = null
                linkGen++
                feed(SessionInput.LinkClosed(reason))
            }
        }
    }

    /** Detaches first, so the close's own onClosed callback is dropped. Idempotent. */
    private fun closeLink() {
        val l = link ?: return
        link = null
        linkGen++
        l.close(CLOSE_REASON)
    }

    /** Idempotent. Late callbacks from the released instance are dropped by generation. */
    private fun releaseDecoder() {
        val d = decoder
        decoder = null
        decoderGen++
        // Frames queued into this instance will never be reported (its late onRendered is
        // dropped by generation): finish them as dropped so the helper's window reopens.
        // The cumulative ack covers every lower seq.
        if (d != null && queuedHighSeq > 0) {
            dropped++
            finishFrame(queuedHighSeq)
        }
        queuedHighSeq = 0
        configSps = null; configPps = null; configW = 0; configH = 0
        needKeyframe = true
        d?.release()
    }

    private fun resetStream() {
        releaseDecoder()
        streamW = null; streamH = null
        lastVideoSeq = 0
        lastIdrRequestAt = Long.MIN_VALUE / 2
        decoderErrorsSinceRender = 0
    }

    private fun onLinkFrame(frame: WireFrame) {
        when (frame) {
            is WireFrame.Json -> {
                val msg = try {
                    ControlMessages.parse(frame.text)
                } catch (e: ProtocolException) {
                    Log.w(TAG, "ignoring control message: ${e.message}")
                    return
                }
                when (msg) {
                    is HelperMessage.HelloAck -> feed(SessionInput.HelloAck(msg.inputEnabled))
                    is HelperMessage.InputState -> {
                        Log.i(TAG, "touch input ${if (msg.inputEnabled) "on" else "off"} (Accessibility on the Mac changed)")
                        feed(SessionInput.InputAccess(msg.inputEnabled))
                    }
                    is HelperMessage.End -> feed(SessionInput.HelperEnd(msg.reason))
                    is HelperMessage.StreamConfig -> {
                        streamW = msg.w; streamH = msg.h
                        Log.i(TAG, "stream config ${msg.w}x${msg.h}")
                        try {
                            events?.emit(EVENT_STREAM, mapOf("w" to msg.w, "h" to msg.h, "orientation" to orientationOf(msg.w, msg.h)))
                        } catch (e: Exception) {
                            Log.w(TAG, "DisplayStreamSize emit failed: ${e.message}")
                        }
                    }
                    HelperMessage.Keepalive -> Unit
                    is HelperMessage.Unknown -> if (loggedUnknown.add(msg.t)) Log.i(TAG, "ignoring unknown message type ${msg.t}")
                }
            }
            is WireFrame.Video -> {
                if (machine.state !is SessionState.Streaming) {
                    if (!frame.isConfig) dropFrame(frame.seq) // finished frames are always acked
                    return
                }
                if (frame.isConfig) onConfig(frame) else onVideo(frame)
            }
        }
    }

    private fun onConfig(frame: WireFrame.Video) {
        val (sps, pps) = try {
            AnnexB.spsPps(frame.payload)
        } catch (e: ProtocolException) {
            Log.e(TAG, "bad config frame: ${e.message}")
            link?.close(VideoLink.REASON_PROTOCOL_ERROR) // reported back through onClosed
            return
        }
        val w = streamW ?: surfaceW
        val h = streamH ?: surfaceH
        if (streamW == null) Log.w(TAG, "config frame before streamConfig; assuming ${w}x$h")
        if (decoder != null && sps.contentEquals(configSps) && pps.contentEquals(configPps) && w == configW && h == configH) return
        rebuildDecoder(sps, pps, w, h)
    }

    private fun rebuildDecoder(sps: ByteArray, pps: ByteArray, w: Int, h: Int) {
        releaseDecoder()
        val s = surface ?: run { Log.w(TAG, "no surface for the decoder"); return }
        val codec = DecoderSelector.choose(codecList, w, h)
        if (codec == null) {
            Log.e(TAG, "no hardware H.264 decoder for ${w}x$h")
            feed(SessionInput.DecoderFailed)
            return
        }
        val gen = ++decoderGen
        val d = decoderFactory(
            { seq -> executor.post { if (gen == decoderGen && decoder != null) onRendered(seq) } },
            { e -> executor.post { if (gen == decoderGen && decoder != null) onDecoderError(e) } },
        )
        try {
            d.configure(s, codec, w, h, sps, pps)
        } catch (e: Exception) {
            Log.e(TAG, "decoder configure failed on ${codec.name} for ${w}x$h", e)
            d.release()
            decoderGen++
            feed(SessionInput.DecoderFailed)
            return
        }
        decoder = d
        configSps = sps; configPps = pps; configW = w; configH = h
        needKeyframe = true
        Log.i(TAG, "decoder ${codec.name} configured for ${w}x$h")
    }

    private fun onVideo(frame: WireFrame.Video) {
        val seq = frame.seq
        if (seq <= lastVideoSeq) { // not monotonic: never decode it
            Log.w(TAG, "out-of-order video seq $seq after $lastVideoSeq")
            dropFrame(seq)
            return
        }
        if (lastVideoSeq != 0L && seq != lastVideoSeq + 1) needKeyframe = true
        lastVideoSeq = seq
        val d = decoder
        if (d == null || (needKeyframe && !frame.isKeyframe)) {
            dropFrame(seq)
            requestIdr()
            return
        }
        if (!d.queue(frame.payload, seq)) {
            dropFrame(seq)
            needKeyframe = true
            requestIdr()
            return
        }
        queuedHighSeq = seq
        if (frame.isKeyframe) needKeyframe = false
    }

    private fun onRendered(seq: Long) {
        rendered++
        decoderErrorsSinceRender = 0
        finishFrame(seq)
    }

    private fun onDecoderError(e: Throwable) {
        Log.w(TAG, "decoder error: ${e.message}")
        val sps = configSps
        val pps = configPps
        val w = configW
        val h = configH
        if (++decoderErrorsSinceRender >= MAX_DECODER_ERRORS || sps == null || pps == null) {
            releaseDecoder()
            feed(SessionInput.DecoderFailed)
            return
        }
        rebuildDecoder(sps, pps, w, h)
        requestIdr()
    }

    private fun dropFrame(seq: Long) {
        dropped++
        finishFrame(seq)
    }

    private fun finishFrame(seq: Long) {
        acker.finished(seq)?.let { link?.send(ControlMessages.ack(it)) }
    }

    private fun requestIdr() {
        val now = clock()
        if (now - lastIdrRequestAt < REQUEST_IDR_MIN_INTERVAL_MS) return
        lastIdrRequestAt = now
        link?.send(ControlMessages.requestIdr())
    }

    private fun isActive(s: SessionState) =
        s is SessionState.AwaitingToken || s is SessionState.Connecting || s is SessionState.Streaming

    private fun scheduleTick() {
        val active = isActive(machine.state)
        if (active && !ticking) {
            ticking = true
            executor.postDelayed(tick, TICK_MS)
        } else if (!active && ticking) {
            ticking = false
            executor.removeCallbacks(tick)
        }
    }

    private fun onTick() {
        ticking = false
        val now = clock()
        feed(SessionInput.Tick(now)) // reschedules while active
        if (machine.state is SessionState.Streaming && link != null) {
            // A lost requestIdr (or a static screen after a rebuild) must not leave us waiting forever.
            if (needKeyframe && decoder != null) requestIdr()
            if (now - lastStatsAt >= STATS_INTERVAL_MS) {
                lastStatsAt = now
                val avg = decoder?.stats()?.decodeMsAvg ?: 0.0
                link?.send(ControlMessages.stats(rendered, dropped, avg))
            }
        }
    }

    companion object {
        const val TAG = "DeskAgentDisplay"
        const val EVENT_STATE = "DisplayState"
        const val EVENT_SIZE = "DisplaySurfaceSize"
        /** Each helper `streamConfig`: the size the Mac streams now (ends the rotate control's "Rotating…"). */
        const val EVENT_STREAM = "DisplayStreamSize"
        const val TOKEN_WAIT_MS = 5000L
        const val TICK_MS = 250L
        const val REQUEST_IDR_MIN_INTERVAL_MS = 500L
        const val STATS_INTERVAL_MS = 5000L
        const val SURFACE_LOST_WAIT_MS = 500L
        const val MAX_DECODER_ERRORS = 3
        private const val CLOSE_REASON = "closed-by-phone"

        fun createDefault(): DisplaySessionRunner {
            val thread = HandlerThread("display-session").apply { start() }
            return DisplaySessionRunner(
                executor = HandlerExecutor(Handler(thread.looper)),
                clock = { SystemClock.elapsedRealtime() },
                linkFactory = { port, listener -> VideoLinkPort(VideoLink(port, listener)) },
                decoderFactory = { onRendered, onError -> HardwareDecoderPort(HardwareDecoder(onRendered, onError)) },
                candidates = { DecoderSelector.fromMediaCodecList() },
            )
        }
    }
}

/** The process-wide display session, shared by [DisplayModule] and [DisplaySurfaceView]. */
object DisplaySession : DisplaySessionHost {
    private val runner: DisplaySessionRunner by lazy {
        DisplaySessionRunner.createDefault().also { it.onStreamingEnded = { cancelGesture() } }
    }
    @Volatile private var view: WeakReference<DisplaySurfaceView>? = null

    /** The requested trackpad mode; the view applies it on its main thread (attach and change). */
    @Volatile var trackpadMode = false
        private set

    override fun nowMs(): Long = runner.nowMs()
    override fun input(input: SessionInput) = runner.input(input)
    override fun tokenOffered(sessionId: String) = runner.tokenOffered(sessionId)
    override fun setEvents(events: DisplayEvents?) = runner.setEvents(events)
    override fun requestSize() = runner.requestSize()
    override fun sendInput(e: SemanticEvent) = runner.sendInput(e)

    /** The recognizer change is posted to the view's main thread; `setTrackpad` goes through the session thread. */
    override fun setTrackpadMode(enabled: Boolean) {
        trackpadMode = enabled
        view?.get()?.let { v -> v.post { v.applyTrackpadMode() } }
        runner.setTrackpadMode(enabled)
    }

    fun surfaceReady(surface: Surface, w: Int, h: Int) = runner.surfaceReady(surface, w, h)
    fun surfaceLost() = runner.surfaceLost()
    fun emitSize(w: Int, h: Int, dpi: Float) = runner.emitSize(w, h, dpi)

    fun attachView(v: DisplaySurfaceView) {
        view = WeakReference(v)
        Log.i(DisplaySessionRunner.TAG, "display view attached")
    }

    fun detachView(v: DisplaySurfaceView) {
        if (view?.get() === v) view = null
        Log.i(DisplaySessionRunner.TAG, "display view detached")
    }

    /** From the session thread: end any gesture in progress, on the view's main thread. */
    private fun cancelGesture() {
        view?.get()?.let { v -> v.post { v.cancelGesture() } }
    }
}
