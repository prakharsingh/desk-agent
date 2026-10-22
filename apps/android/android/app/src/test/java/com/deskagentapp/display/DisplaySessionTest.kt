package com.deskagentapp.display

import android.view.Surface
import io.mockk.mockk
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowLog

/** Single-threaded stand-in for the display-session HandlerThread: tasks run only on drain/advance. */
private class ManualExecutor(private val clock: LongArray) : SessionExecutor {
    private data class Task(val at: Long, val r: Runnable)
    private val tasks = mutableListOf<Task>()
    var draining = false
        private set

    override fun post(r: Runnable) { tasks += Task(clock[0], r) }
    override fun postDelayed(r: Runnable, delayMs: Long) { tasks += Task(clock[0] + delayMs, r) }
    override fun removeCallbacks(r: Runnable) { tasks.removeAll { it.r === r } }
    override fun isCurrentThread(): Boolean = draining

    fun drain() {
        while (true) {
            val t = tasks.filter { it.at <= clock[0] }.minByOrNull { it.at } ?: return
            tasks.remove(t)
            draining = true
            try { t.r.run() } finally { draining = false }
        }
    }

    fun advance(ms: Long) { clock[0] += ms; drain() }

    fun pending(): Int = tasks.size
}

/** Cross-fake call order, e.g. decoder release vs link close. */
private val callLog = mutableListOf<String>()

private class FakeLink(val port: Int, val listener: VideoLink.Listener, private val exec: ManualExecutor) : LinkPort {
    var hello: String? = null
    val sent = mutableListOf<String>()
    val closes = mutableListOf<String>()
    var offThreadCalls = 0

    override fun open(helloJson: String) { if (!exec.isCurrentThread()) offThreadCalls++; hello = helloJson }
    override fun send(json: String): Boolean { if (!exec.isCurrentThread()) offThreadCalls++; sent += json; return true }
    override fun close(reason: String) {
        if (!exec.isCurrentThread()) offThreadCalls++
        if (closes.isNotEmpty()) return
        closes += reason
        callLog += "link.close"
        listener.onClosed(reason) // like VideoLink: reports synchronously, re-entrantly
    }

    fun sentTypes() = sent.map { JSONObject(it).getString("t") }
    fun acks() = sent.map { JSONObject(it) }.filter { it.getString("t") == "ack" }.map { it.getLong("seq") }
}

private class FakeDecoder(val onRendered: (Long) -> Unit, val onError: (Throwable) -> Unit) : DecoderPort {
    var configured: Pair<Int, Int>? = null
    val queued = mutableListOf<Long>()
    var releases = 0
    override fun configure(surface: Surface, codec: CodecCandidate, w: Int, h: Int, sps: ByteArray, pps: ByteArray) {
        if (throwOnConfigure) throw IllegalStateException("configure failed")
        configured = w to h
    }
    override fun queue(annexB: ByteArray, seq: Long): Boolean {
        if (!queueResult) return false
        queued += seq; return true
    }
    override fun release() { releases++; callLog += "decoder.release" }

    companion object {
        var throwOnConfigure = false
        var queueResult = true
    }
    override fun stats() = DecoderStats(0, 0, 0.0)
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class DisplaySessionTest {
    private val clock = longArrayOf(1_000)
    private val exec = ManualExecutor(clock)
    private val links = mutableListOf<FakeLink>()
    private val decoders = mutableListOf<FakeDecoder>()
    private val emitted = mutableListOf<Pair<String, Map<String, Any?>>>()
    private val codec = CodecCandidate("c2.qti.avc.decoder", true, false, 4096, 2176) { _, _ -> true }
    private lateinit var s: DisplaySessionRunner

    @Before fun setUp() {
        DisplayTokenHolder.clear()
        callLog.clear()
        FakeDecoder.throwOnConfigure = false
        FakeDecoder.queueResult = true
        ShadowLog.clear()
        s = DisplaySessionRunner(
            executor = exec,
            clock = { clock[0] },
            linkFactory = { port, l -> FakeLink(port, l, exec).also { links += it } },
            decoderFactory = { r, e -> FakeDecoder(r, e).also { decoders += it } },
            candidates = { listOf(codec) },
        )
        s.setEvents(object : DisplayEvents {
            override fun emit(name: String, body: Map<String, Any?>) { emitted += name to body }
        })
    }

    @After fun tearDown() = DisplayTokenHolder.clear()

    private fun states() = emitted.filter { it.first == "DisplayState" }.map { it.second }

    private fun json(t: String, vararg kv: Pair<String, Any>) =
        WireFrame.Json(JSONObject().apply { put("t", t); kv.forEach { put(it.first, it.second) } }.toString())

    private fun config(ppsByte: Int = 0x11) = WireFrame.Video(
        FrameCodec.FLAG_CONFIG, 0,
        byteArrayOf(0, 0, 0, 1, 0x67, 0x42, 0, 0, 0, 1, 0x68, ppsByte.toByte()),
    )

    private fun video(seq: Long, key: Boolean) =
        WireFrame.Video(if (key) FrameCodec.FLAG_KEYFRAME else 0, seq, byteArrayOf(0, 0, 0, 1, 0x65, 1))

    private fun connect(id: String = "s1"): FakeLink {
        s.input(SessionInput.Start(id, 8788, clock[0]))
        s.surfaceReady(mockk(relaxed = true), 2340, 1080)
        s.input(SessionInput.TokenAvailable(id, "secret-token-$id"))
        exec.drain()
        return links.last()
    }

    private fun streaming(id: String = "s1"): FakeLink {
        val l = connect(id)
        l.listener.onFrame(json("helloAck", "inputEnabled" to true))
        exec.drain()
        return l
    }

    @Test fun `opens the link on the session thread with hello carrying the decoder limits`() {
        val l = connect()
        val hello = JSONObject(l.hello!!)
        assertEquals("hello", hello.getString("t"))
        assertEquals(8788, l.port)
        assertEquals(4096, hello.getInt("maxW")); assertEquals(2176, hello.getInt("maxH"))
        assertEquals(2340, hello.getInt("surfaceW")); assertFalse(hello.getBoolean("trackpad"))
        assertEquals(0, l.offThreadCalls)
        assertEquals(listOf(mapOf<String, Any?>("state" to "connecting")), states())
    }

    @Test fun `link callbacks are posted onto the session thread, not run inline`() {
        val l = connect()
        l.listener.onFrame(json("helloAck", "inputEnabled" to false))
        assertEquals(1, states().size) // nothing fed yet
        exec.drain()
        assertEquals(mapOf("state" to "streaming", "inputEnabled" to false), states().last())
    }

    @Test fun `callbacks from a superseded link are dropped`() {
        val old = streaming("s1")
        s.input(SessionInput.Start("s2", 8788, clock[0]))
        exec.drain()
        assertEquals(1, old.closes.size)
        // a late frame and a late close from the old link must not reach the machine
        old.listener.onFrame(json("end", "reason" to "stop-requested"))
        old.listener.onClosed("link-lost")
        exec.drain()
        assertEquals("connecting", states().last()["state"])
        assertTrue(s.stateForTest() is SessionState.AwaitingToken)
    }

    @Test fun `helper end closes the link and a later link-lost changes nothing`() {
        val l = streaming()
        l.listener.onFrame(json("end", "reason" to "stop-requested"))
        exec.drain()
        assertEquals(1, l.closes.size)
        assertEquals(mapOf("state" to "ended", "reason" to "stop-requested"), states().last())
        val n = states().size
        l.listener.onClosed("link-lost")
        exec.drain()
        assertEquals(n, states().size)
        assertEquals(SessionState.Ended("stop-requested"), s.stateForTest())
    }

    @Test fun `link loss before helloAck is a connect-failed error, not a silent end`() {
        val l = connect()
        l.listener.onClosed("link-lost")
        exec.drain()
        assertEquals(mapOf("state" to "error", "reason" to "connect-failed"), states().last())
        assertEquals(SessionState.Ended("connect-failed"), s.stateForTest())
    }

    @Test fun `link loss ends the session with the link's reason`() {
        val l = streaming()
        l.listener.onClosed("link-lost")
        exec.drain()
        assertEquals(mapOf("state" to "ended", "reason" to "link-lost"), states().last())
    }

    @Test fun `frames before a keyframe are dropped, acked and trigger a throttled requestIdr`() {
        val l = streaming()
        l.listener.onFrame(json("streamConfig", "w" to 1920, "h" to 886))
        l.listener.onFrame(config())
        l.listener.onFrame(video(1, key = false))
        l.listener.onFrame(video(2, key = false))
        exec.drain()
        assertEquals(1920 to 886, decoders.single().configured)
        assertEquals(listOf(1L, 2L), l.acks())
        assertEquals(1, l.sentTypes().count { it == "requestIdr" })
        assertTrue(decoders.single().queued.isEmpty())
        clock[0] += 600
        l.listener.onFrame(video(3, key = false))
        exec.drain()
        assertEquals(2, l.sentTypes().count { it == "requestIdr" })
        l.listener.onFrame(video(4, key = true))
        l.listener.onFrame(video(5, key = false))
        exec.drain()
        assertEquals(listOf(4L, 5L), decoders.single().queued)
        decoders.single().onRendered(5)
        exec.drain()
        assertEquals(listOf(1L, 2L, 3L, 5L), l.acks())
    }

    @Test fun `a gap in seq waits for the next keyframe`() {
        val l = streaming()
        l.listener.onFrame(json("streamConfig", "w" to 1920, "h" to 886))
        l.listener.onFrame(config())
        l.listener.onFrame(video(1, key = true))
        l.listener.onFrame(video(3, key = false))
        exec.drain()
        assertEquals(listOf(1L), decoders.single().queued)
        assertEquals(listOf(3L), l.acks())
        assertEquals(1, l.sentTypes().count { it == "requestIdr" })
    }

    @Test fun `callbacks from a released decoder are ignored`() {
        val l = streaming()
        l.listener.onFrame(json("streamConfig", "w" to 1920, "h" to 886))
        l.listener.onFrame(config(0x11))
        l.listener.onFrame(video(1, key = true))
        exec.drain()
        val first = decoders.single()
        // same config again: no rebuild
        l.listener.onFrame(config(0x11))
        exec.drain()
        assertEquals(1, decoders.size)
        // new PPS: rebuild
        l.listener.onFrame(config(0x22))
        exec.drain()
        assertEquals(2, decoders.size)
        assertEquals(1, first.releases)
        first.onRendered(1)
        first.onError(IllegalStateException("late"))
        exec.drain()
        assertEquals(listOf(1L), l.acks()) // the rebuild finished seq 1; the stale render adds nothing
        assertEquals(2, decoders.size) // the stale error did not trigger a rebuild
        l.listener.onFrame(video(2, key = true))
        exec.drain()
        decoders.last().onRendered(2)
        exec.drain()
        assertEquals(listOf(1L, 2L), l.acks())
    }

    @Test fun `no usable decoder ends the session with decoder-error`() {
        s = DisplaySessionRunner(
            executor = exec, clock = { clock[0] },
            linkFactory = { port, l -> FakeLink(port, l, exec).also { links += it } },
            decoderFactory = { r, e -> FakeDecoder(r, e).also { decoders += it } },
            candidates = { emptyList() },
        )
        s.setEvents(object : DisplayEvents {
            override fun emit(name: String, body: Map<String, Any?>) { emitted += name to body }
        })
        s.input(SessionInput.Start("s1", 8788, clock[0]))
        s.surfaceReady(mockk(relaxed = true), 2340, 1080)
        s.input(SessionInput.TokenAvailable("s1", "tok"))
        exec.drain()
        assertEquals(mapOf("state" to "error", "reason" to "decoder-error"), states().last())
    }

    @Test fun `release and clear-token actions are idempotent when nothing exists`() {
        s.input(SessionInput.Start("s1", 8788, clock[0]))
        s.input(SessionInput.Start("s2", 8788, clock[0])) // supersede from AwaitingToken: ReleaseDecoder + ClearToken
        s.input(SessionInput.UserStop)
        s.input(SessionInput.UserStop)
        exec.drain()
        assertEquals(listOf("connecting", "connecting", "ended"), states().map { it["state"] })
    }

    @Test fun `a token offered after start is taken only for the awaited session`() {
        s.input(SessionInput.Start("s1", 8788, clock[0]))
        exec.drain()
        DisplayTokenHolder.offer("s9", "other")
        s.tokenOffered("s9")
        exec.drain()
        assertEquals("other", DisplayTokenHolder.take("s9")) // untouched
        s.surfaceReady(mockk(relaxed = true), 2340, 1080)
        DisplayTokenHolder.offer("s1", "mine")
        s.tokenOffered("s1")
        exec.drain()
        assertEquals(1, links.size)
    }

    @Test fun `a token that lands between the module's take and Start is still used`() {
        s.surfaceReady(mockk(relaxed = true), 2340, 1080)
        // module's take() found nothing; the intent lands before Start is processed
        s.input(SessionInput.Start("s1", 8788, clock[0]))
        DisplayTokenHolder.offer("s1", "late")
        s.tokenOffered("s1")
        exec.drain()
        assertEquals(1, links.size)
    }

    @Test fun `requestSize re-emits the last surface size, and nothing once the surface is lost`() {
        s.requestSize()
        assertEquals(0, emitted.count { it.first == "DisplaySurfaceSize" })
        s.emitSize(2340, 1080, 420f)
        emitted.clear()
        s.requestSize()
        assertEquals(listOf("DisplaySurfaceSize"), emitted.map { it.first })
        assertEquals(DisplayModule.sizeEventMap(2340, 1080, 420f), emitted[0].second)
        s.surfaceLost()
        exec.drain()
        emitted.clear()
        s.requestSize()
        assertEquals(0, emitted.size)
    }

    @Test fun `token timeout after 5 s via ticks`() {
        s.input(SessionInput.Start("s1", 8788, clock[0]))
        exec.drain()
        exec.advance(5_250)
        assertEquals(mapOf("state" to "error", "reason" to "token-timeout"), states().last())
    }

    @Test fun `sends stats every 5 s while streaming`() {
        val l = streaming()
        exec.advance(5_000)
        assertTrue(l.sentTypes().contains("stats"))
    }

    @Test fun `user stop sends bye then closes, on the session thread`() {
        val l = streaming()
        s.input(SessionInput.UserStop)
        exec.drain()
        assertEquals("bye", l.sentTypes().last())
        assertEquals(1, l.closes.size)
        assertEquals(0, l.offThreadCalls)
        assertEquals(mapOf("state" to "ended", "reason" to "user-exit"), states().last())
    }

    @Test fun `never logs the token`() {
        streaming()
        val logged = ShadowLog.getLogs().joinToString("\n") { it.msg ?: "" }
        assertFalse(logged.contains("secret-token"))
        assertTrue(ShadowLog.getLogsForTag("DeskAgentDisplay").isNotEmpty())
    }

    private fun configured(l: FakeLink, ppsByte: Int = 0x11) {
        l.listener.onFrame(json("streamConfig", "w" to 1920, "h" to 886))
        l.listener.onFrame(config(ppsByte))
        exec.drain()
    }

    @Test fun `frames queued into a decoder that is rebuilt are acked at the rebuild`() {
        val l = streaming()
        configured(l, 0x11)
        for (seq in 1L..9L) l.listener.onFrame(video(seq, key = seq == 1L))
        exec.drain()
        decoders.single().onRendered(9)
        exec.drain()
        l.listener.onFrame(video(10, key = false))
        l.listener.onFrame(video(11, key = false))
        exec.drain()
        assertEquals(listOf(9L), l.acks())
        l.listener.onFrame(config(0x22)) // changed PPS: rebuild
        exec.drain()
        assertEquals(2, decoders.size)
        assertEquals(listOf(9L, 11L), l.acks())
        decoders.first().onRendered(10) // late, from the released instance: dropped
        exec.drain()
        assertEquals(listOf(9L, 11L), l.acks())
        // A seq above the last ack, so FrameAcker alone would ack it: only the generation guard stops it.
        decoders.first().onRendered(50)
        exec.drain()
        assertEquals(listOf(9L, 11L), l.acks())
        exec.advance(5_000) // next stats: rendered still counts only seq 9
        val stats = l.sent.map { JSONObject(it) }.last { it.getString("t") == "stats" }
        assertEquals(1L, stats.getLong("rendered"))
    }

    @Test fun `frames queued into a decoder released at session end are acked before the link closes`() {
        val l = streaming()
        configured(l)
        l.listener.onFrame(video(1, key = true))
        l.listener.onFrame(video(2, key = false))
        exec.drain()
        s.input(SessionInput.UserStop)
        exec.drain()
        assertEquals(listOf(2L), l.acks())
        assertEquals("bye", l.sentTypes().last())
    }

    @Test fun `on end the decoder is released before the link is closed`() {
        val l = streaming()
        configured(l)
        s.input(SessionInput.UserStop)
        exec.drain()
        assertEquals(listOf("decoder.release", "link.close"), callLog)
        assertEquals(1, l.closes.size)
    }

    @Test fun `video arriving while not streaming is still acked`() {
        val l = connect() // Connecting: no helloAck yet
        l.listener.onFrame(video(1, key = true))
        l.listener.onFrame(config())
        exec.drain()
        assertEquals(listOf(1L), l.acks())
        assertTrue(decoders.isEmpty())
    }

    @Test fun `an identical config does not rebuild the decoder`() {
        val l = streaming()
        configured(l)
        l.listener.onFrame(json("streamConfig", "w" to 1920, "h" to 886))
        l.listener.onFrame(config())
        exec.drain()
        assertEquals(1, decoders.size)
        assertEquals(0, decoders.single().releases)
    }

    @Test fun `a resized streamConfig with the same SPS and PPS rebuilds the decoder`() {
        val l = streaming()
        configured(l)
        l.listener.onFrame(json("streamConfig", "w" to 1280, "h" to 590))
        l.listener.onFrame(config())
        exec.drain()
        assertEquals(2, decoders.size)
        assertEquals(1280 to 590, decoders.last().configured)
    }

    // ---- rotation (Task 4.5) ----

    @Test fun `a surfaceChanged with a new size while streaming sends resize, not bye`() {
        val l = streaming() // hello at 2340x1080
        val surface = mockk<Surface>(relaxed = true)
        s.surfaceReady(surface, 1080, 2340)
        exec.drain()
        val resize = l.sent.map { JSONObject(it) }.single { it.getString("t") == "resize" }
        assertEquals(1080, resize.getInt("surfaceW")); assertEquals(2340, resize.getInt("surfaceH"))
        assertEquals("portrait", resize.getString("orientation"))
        assertFalse("bye" in l.sentTypes())
        assertTrue(l.closes.isEmpty())
        assertTrue(s.stateForTest() is SessionState.Streaming)
        // A repeated surfaceChanged at the same size sends nothing more.
        s.surfaceReady(surface, 1080, 2340)
        exec.drain()
        assertEquals(1, l.sentTypes().count { it == "resize" })
    }

    @Test fun `a surfaceChanged before the link opens only changes the hello size`() {
        s.input(SessionInput.Start("s1", 8788, clock[0]))
        val surface = mockk<Surface>(relaxed = true)
        s.surfaceReady(surface, 2340, 1080)
        s.surfaceReady(surface, 1080, 2340)
        s.input(SessionInput.TokenAvailable("s1", "secret-token-s1"))
        exec.drain()
        val l = links.single()
        val hello = JSONObject(l.hello!!)
        assertEquals(1080, hello.getInt("surfaceW")); assertEquals(2340, hello.getInt("surfaceH"))
        l.listener.onFrame(json("helloAck", "inputEnabled" to true))
        exec.drain()
        assertFalse("resize" in l.sentTypes())
    }

    @Test fun `during the rotation blink old-size frames keep decoding until the new config rebuilds`() {
        val l = streaming()
        configured(l) // 1920x886
        l.listener.onFrame(video(1, key = true))
        exec.drain()
        s.surfaceReady(mockk(relaxed = true), 1080, 2340)
        exec.drain()
        // Old-size frames still arrive: decoded into the same decoder, no rebuild yet.
        l.listener.onFrame(video(2, key = false))
        exec.drain()
        assertEquals(1, decoders.size)
        assertEquals(listOf(1L, 2L), decoders.single().queued)
        // The helper's new streamConfig + config frame rebuild it; the in-flight frames are acked.
        l.listener.onFrame(json("streamConfig", "w" to 886, "h" to 1920))
        l.listener.onFrame(config(0x22))
        exec.drain()
        assertEquals(2, decoders.size)
        assertEquals(886 to 1920, decoders.last().configured)
        assertEquals(listOf(2L), l.acks())
        l.listener.onFrame(video(3, key = true))
        exec.drain()
        assertEquals(listOf(3L), decoders.last().queued)
    }

    @Test fun `configure throwing ends the session with decoder-error`() {
        FakeDecoder.throwOnConfigure = true
        val l = streaming()
        configured(l)
        assertEquals(mapOf("state" to "error", "reason" to "decoder-error"), states().last())
        assertEquals(1, decoders.single().releases)
        assertEquals("bye", l.sentTypes().last())
        assertEquals(1, l.closes.size)
    }

    @Test fun `queue returning false drops and acks the frame and waits for a keyframe`() {
        val l = streaming()
        configured(l)
        FakeDecoder.queueResult = false
        l.listener.onFrame(video(1, key = true))
        exec.drain()
        assertEquals(listOf(1L), l.acks())
        assertEquals(1, l.sentTypes().count { it == "requestIdr" })
        FakeDecoder.queueResult = true
        l.listener.onFrame(video(2, key = false)) // still waiting for a keyframe
        l.listener.onFrame(video(3, key = true))
        exec.drain()
        assertEquals(listOf(3L), decoders.single().queued)
        assertEquals(listOf(1L, 2L), l.acks())
    }

    @Test fun `a malformed config frame closes the link with protocol-error`() {
        val l = streaming()
        l.listener.onFrame(WireFrame.Video(FrameCodec.FLAG_CONFIG, 0, byteArrayOf(0, 0, 0, 1, 0x65, 1)))
        exec.drain()
        assertEquals(listOf(VideoLink.REASON_PROTOCOL_ERROR), l.closes)
        assertEquals(mapOf("state" to "error", "reason" to "protocol-error"), states().last())
    }

    @Test fun `no tick is pending after the session ends`() {
        streaming()
        exec.advance(300) // ticks are running
        s.input(SessionInput.UserStop)
        exec.drain()
        assertEquals(0, exec.pending())
    }

    @Test fun `three decoder errors without a render end the session with decoder-error`() {
        val l = streaming()
        configured(l)
        decoders.last().onError(IllegalStateException("e1"))
        exec.drain()
        assertEquals(2, decoders.size) // rebuilt
        assertEquals("streaming", states().last()["state"])
        decoders.last().onError(IllegalStateException("e2"))
        exec.drain()
        assertEquals(3, decoders.size)
        decoders.last().onError(IllegalStateException("e3"))
        exec.drain()
        assertEquals(mapOf("state" to "error", "reason" to "decoder-error"), states().last())
    }

    // ---- input and trackpad (Task 4.4) ----

    private fun inputs(l: FakeLink) = l.sent.map { JSONObject(it) }.filter { it.getString("t") == "input" }

    @Test fun `sendInput is posted to the session thread and sent while streaming with input enabled`() {
        val l = streaming()
        s.sendInput(SemanticEvent.Click(0.5f, 0.25f))
        assertTrue(inputs(l).isEmpty()) // not sent inline on the caller's thread
        exec.drain()
        assertEquals(listOf("click"), inputs(l).map { it.getString("e") })
        assertEquals(0, l.offThreadCalls)
    }

    @Test fun `sendInput is dropped when input is disabled`() {
        val l = connect()
        l.listener.onFrame(json("helloAck", "inputEnabled" to false))
        exec.drain()
        s.sendInput(SemanticEvent.Click(0.5f, 0.25f))
        exec.drain()
        assertTrue(inputs(l).isEmpty())
    }

    @Test fun `sendInput is dropped before helloAck and after the session ends`() {
        val l = connect()
        s.sendInput(SemanticEvent.Click(0.5f, 0.25f))
        exec.drain()
        assertTrue(inputs(l).isEmpty())
        l.listener.onFrame(json("helloAck", "inputEnabled" to true))
        exec.drain()
        s.input(SessionInput.UserStop)
        exec.drain()
        s.sendInput(SemanticEvent.DragEnd(0.5f, 0.25f))
        exec.drain()
        assertTrue(inputs(l).isEmpty())
    }

    @Test fun `hello carries the current trackpad mode`() {
        s.setTrackpadMode(true)
        val l = connect()
        assertTrue(JSONObject(l.hello!!).getBoolean("trackpad"))
    }

    @Test fun `setTrackpadMode while streaming sends setTrackpad on the session thread`() {
        val l = streaming()
        s.setTrackpadMode(true)
        assertTrue(l.sentTypes().none { it == "setTrackpad" })
        exec.drain()
        val tp = l.sent.map { JSONObject(it) }.single { it.getString("t") == "setTrackpad" }
        assertTrue(tp.getBoolean("enabled"))
        assertEquals(0, l.offThreadCalls)
        s.setTrackpadMode(true) // unchanged: nothing more to tell the helper
        exec.drain()
        assertEquals(1, l.sentTypes().count { it == "setTrackpad" })
    }

    @Test fun `a trackpad change while connecting is sent once streaming`() {
        val l = connect()
        s.setTrackpadMode(true)
        exec.drain()
        assertTrue(l.sentTypes().none { it == "setTrackpad" })
        l.listener.onFrame(json("helloAck", "inputEnabled" to true))
        exec.drain()
        assertEquals(1, l.sentTypes().count { it == "setTrackpad" })
    }

    @Test fun `leaving streaming notifies the input-stopped listener once`() {
        var stopped = 0
        s.onStreamingEnded = { stopped++ }
        streaming()
        assertEquals(0, stopped)
        s.input(SessionInput.UserStop)
        exec.drain()
        assertEquals(1, stopped)
        s.input(SessionInput.UserStop)
        exec.drain()
        assertEquals(1, stopped)
    }
}
