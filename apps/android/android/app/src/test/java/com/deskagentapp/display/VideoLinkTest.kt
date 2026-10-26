package com.deskagentapp.display

import java.io.DataInputStream
import java.io.DataOutputStream
import java.net.ServerSocket
import java.net.Socket
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
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

/**
 * Real loopback sockets: a [ServerSocket] on an ephemeral port plays the helper.
 * Timing assertions use latches with generous upper bounds; lower bounds are only
 * asserted where they *are* the behaviour (the watchdog must not fire early).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class VideoLinkTest {
    private lateinit var server: ServerSocket
    private val links = mutableListOf<VideoLink>()
    private val peers = mutableListOf<Socket>()
    private val stopFeeding = AtomicBoolean(false)

    private class Recorder : VideoLink.Listener {
        val frames: MutableList<WireFrame> = Collections.synchronizedList(mutableListOf())
        val reasons: MutableList<String> = Collections.synchronizedList(mutableListOf())
        val closed = CountDownLatch(1)
        @Volatile var closedAtNanos = 0L
        override fun onFrame(frame: WireFrame) { frames.add(frame) }
        override fun onClosed(reason: String) {
            reasons.add(reason); closedAtNanos = System.nanoTime(); closed.countDown()
        }
    }

    /** The helper's end of one connection. */
    private inner class Peer(val socket: Socket) {
        val input = DataInputStream(socket.getInputStream())
        private val out = DataOutputStream(socket.getOutputStream())
        @Synchronized fun sendJson(json: String) { out.write(FrameCodec.encodeJson(json)); out.flush() }
        @Synchronized fun sendVideo(flags: Int, seq: Long, payload: ByteArray) {
            out.writeInt(10 + payload.size); out.writeByte(FrameCodec.KIND_VIDEO); out.writeByte(flags)
            out.writeLong(seq); out.write(payload); out.flush()
        }
        @Synchronized fun sendRaw(bytes: ByteArray) { out.write(bytes); out.flush() }
        fun readJson(): JSONObject = JSONObject((FrameCodec.read(input) as WireFrame.Json).text)
        /** Feeds the phone's watchdog from a background thread until the test ends. */
        fun feed(everyMs: Long, send: Peer.() -> Unit) = Thread {
            try { while (!stopFeeding.get()) { send(); Thread.sleep(everyMs) } } catch (_: Exception) {}
        }.apply { isDaemon = true; start() }
    }

    @Before fun setUp() { server = ServerSocket(0) }

    @After fun tearDown() {
        stopFeeding.set(true)
        links.forEach { it.close("test-teardown") }
        peers.forEach { runCatching { it.close() } }
        server.close()
    }

    private fun link(
        listener: VideoLink.Listener,
        port: Int = server.localPort,
        watchdogActiveMs: Long = 300,
        watchdogPausedMs: Long = 1000,
    ) = VideoLink(
        port, listener, clock = System::currentTimeMillis,
        keepaliveMs = 100, watchdogActiveMs = watchdogActiveMs, watchdogPausedMs = watchdogPausedMs,
    ).also { links += it }

    private fun accept(): Peer {
        server.soTimeout = 5000
        return Peer(server.accept().also { peers += it; it.soTimeout = 5000 })
    }

    private fun hello() = ControlMessages.hello("tok", "s1", 2340, 1080, 4096, 2304, false)
    private fun elapsedMs(fromNanos: Long, toNanos: Long) = (toNanos - fromNanos) / 1_000_000

    @Test fun `sends hello as the first frame`() {
        val rec = Recorder()
        val l = link(rec)
        l.open(hello())
        l.send(ControlMessages.requestIdr())
        val peer = accept()
        val first = peer.readJson()
        assertEquals("hello", first.getString("t"))
        assertEquals("tok", first.getString("token"))
        assertEquals("requestIdr", peer.readJson().getString("t"))
    }

    @Test fun `sets TCP_NODELAY`() {
        val l = link(Recorder())
        l.open(hello())
        accept()
        assertTrue(l.socketForTest!!.tcpNoDelay)
    }

    @Test fun `sends keepalives on schedule`() {
        val l = link(Recorder(), watchdogActiveMs = 10_000)
        l.open(hello())
        val peer = accept()
        peer.readJson() // hello
        val start = System.nanoTime()
        var keepalives = 0
        val seen = LinkedBlockingQueue<String>()
        Thread { try { while (true) seen.put(peer.readJson().getString("t")) } catch (_: Exception) {} }
            .apply { isDaemon = true; start() }
        while (System.nanoTime() - start < 450_000_000L) {
            val remaining = 450 - elapsedMs(start, System.nanoTime())
            val t = seen.poll(remaining.coerceAtLeast(1), TimeUnit.MILLISECONDS) ?: continue
            if (t == "keepalive") keepalives++
        }
        assertTrue("expected >= 3 keepalives in 450 ms, saw $keepalives", keepalives >= 3)
        assertTrue("keepalives must be paced, saw $keepalives", keepalives <= 6)
    }

    @Test fun `closes with link-lost when the helper goes silent`() {
        val rec = Recorder()
        val l = link(rec)
        val start = System.nanoTime()
        l.open(hello())
        accept().readJson()
        assertTrue("watchdog never fired", rec.closed.await(3, TimeUnit.SECONDS))
        assertEquals(listOf("link-lost"), rec.reasons)
        val ms = elapsedMs(start, rec.closedAtNanos)
        assertTrue("watchdog fired early at $ms ms", ms >= 290)
    }

    @Test fun `tolerates silence up to the paused watchdog while paused`() {
        val rec = Recorder()
        val l = link(rec)
        val start = System.nanoTime()
        l.open(hello())
        l.setPaused(true)
        accept().readJson()
        assertFalse("closed while paused before 600 ms", rec.closed.await(600, TimeUnit.MILLISECONDS))
        assertTrue("paused watchdog never fired", rec.closed.await(5, TimeUnit.SECONDS))
        assertEquals(listOf("link-lost"), rec.reasons)
        val ms = elapsedMs(start, rec.closedAtNanos)
        assertTrue("paused watchdog fired early at $ms ms", ms >= 990)
    }

    @Test fun `resuming restores the active watchdog`() {
        val rec = Recorder()
        val l = link(rec)
        l.open(hello())
        l.setPaused(true)
        accept().readJson()
        assertFalse(rec.closed.await(400, TimeUnit.MILLISECONDS))
        l.setPaused(false) // silent for > 300 ms already: the active limit applies at once
        assertTrue(rec.closed.await(2, TimeUnit.SECONDS))
        assertEquals(listOf("link-lost"), rec.reasons)
    }

    @Test fun `reports connect-failed when nothing listens`() {
        val port = ServerSocket(0).use { it.localPort }
        val rec = Recorder()
        link(rec, port = port).open(hello())
        assertTrue(rec.closed.await(5, TimeUnit.SECONDS))
        assertEquals(listOf("connect-failed"), rec.reasons)
    }

    @Test fun `delivers frames in order`() {
        val rec = Recorder()
        link(rec, watchdogActiveMs = 10_000).open(hello())
        val peer = accept()
        peer.readJson()
        peer.sendJson("""{"t":"helloAck","inputEnabled":true}""")
        peer.sendJson("""{"t":"streamConfig","w":1920,"h":1080}""")
        peer.sendVideo(FrameCodec.FLAG_CONFIG, 0, byteArrayOf(0, 0, 0, 1, 0x67))
        for (seq in 1L..20L) peer.sendVideo(if (seq == 1L) FrameCodec.FLAG_KEYFRAME else 0, seq, byteArrayOf(seq.toByte()))
        peer.sendJson("""{"t":"cursor","x":1}""")
        val deadline = System.nanoTime() + 5_000_000_000L
        while (rec.frames.size < 24 && System.nanoTime() < deadline) Thread.sleep(5)
        val frames = synchronized(rec.frames) { rec.frames.toList() }
        assertEquals(24, frames.size)
        assertTrue((frames[0] as WireFrame.Json).text.contains("helloAck"))
        assertTrue((frames[1] as WireFrame.Json).text.contains("streamConfig"))
        assertTrue((frames[2] as WireFrame.Video).isConfig)
        assertEquals((1L..20L).toList(), frames.subList(3, 23).map { (it as WireFrame.Video).seq })
        assertTrue((frames[23] as WireFrame.Json).text.contains("cursor"))
        assertEquals(emptyList<String>(), rec.reasons)
    }

    @Test fun `any valid frame feeds the watchdog`() {
        val rec = Recorder()
        link(rec).open(hello())
        val peer = accept()
        peer.readJson()
        var seq = 0L
        peer.feed(100) { sendVideo(0, ++seq, byteArrayOf(1)) }
        assertFalse("closed despite video every 100 ms", rec.closed.await(900, TimeUnit.MILLISECONDS))
        stopFeeding.set(true)
        assertTrue("watchdog never fired after feeding stopped", rec.closed.await(3, TimeUnit.SECONDS))
        assertEquals(listOf("link-lost"), rec.reasons)
    }

    @Test fun `unknown control messages feed the watchdog`() {
        val rec = Recorder()
        link(rec).open(hello())
        val peer = accept()
        peer.readJson()
        peer.feed(100) { sendJson("""{"t":"somethingNew","n":1}""") }
        assertFalse("closed despite unknown-t frames every 100 ms", rec.closed.await(900, TimeUnit.MILLISECONDS))
        assertTrue(rec.reasons.isEmpty())
    }

    @Test fun `closes with protocol-error on bad framing`() {
        val rec = Recorder()
        link(rec).open(hello())
        val peer = accept()
        peer.readJson()
        peer.sendRaw(byteArrayOf(0, 0, 0, 2, 0x09, 0))
        assertTrue(rec.closed.await(3, TimeUnit.SECONDS))
        assertEquals(listOf("protocol-error"), rec.reasons)
        assertTrue(rec.frames.isEmpty())
    }

    @Test fun `closes with protocol-error on invalid json`() {
        val rec = Recorder()
        link(rec).open(hello())
        val peer = accept()
        peer.readJson()
        peer.sendJson("""{"no-t":1}""")
        assertTrue(rec.closed.await(3, TimeUnit.SECONDS))
        assertEquals(listOf("protocol-error"), rec.reasons)
        assertTrue(rec.frames.isEmpty())
    }

    @Test fun `closes with link-lost when the helper closes the socket`() {
        val rec = Recorder()
        link(rec, watchdogActiveMs = 10_000).open(hello())
        val peer = accept()
        peer.readJson()
        peer.sendJson("""{"t":"end","reason":"stop-requested"}""")
        peer.socket.close()
        assertTrue(rec.closed.await(3, TimeUnit.SECONDS))
        assertEquals(listOf("link-lost"), rec.reasons)
        // the end message reaches the listener before the close
        assertEquals(1, rec.frames.size)
        assertTrue((rec.frames[0] as WireFrame.Json).text.contains("\"end\""))
    }

    @Test fun `close reports exactly once`() {
        val rec = Recorder()
        val l = link(rec)
        l.open(hello())
        val peer = accept()
        peer.readJson()
        val go = CountDownLatch(1)
        val closers = (1..8).map { Thread { go.await(); l.close("user-exit") }.apply { start() } }
        go.countDown()
        closers.forEach { it.join(5000) }
        l.close("again")
        assertTrue("link threads still alive", l.threadsForTest().none { it.isAlive })
        while (peer.input.read() != -1) Unit // drains queued keepalives; times out if the phone never closed
        peer.socket.close()
        Thread.sleep(500) // past the 300 ms watchdog: nothing else may report
        assertEquals(listOf("user-exit"), rec.reasons)
    }

    @Test fun `send after close is a no-op`() {
        val rec = Recorder()
        val l = link(rec)
        l.open(hello())
        accept().readJson()
        l.close("user-exit")
        assertFalse(l.send(ControlMessages.keepalive()))
        l.setPaused(true)
        assertEquals(listOf("user-exit"), rec.reasons)
    }

    @Test fun `close before connect reports once and open does nothing`() {
        val rec = Recorder()
        val l = link(rec)
        l.close("user-exit")
        l.open(hello())
        assertEquals(listOf("user-exit"), rec.reasons)
        assertTrue(l.threadsForTest().isEmpty())
    }

    /** A JSON object whose UTF-8 body is exactly [bodyBytes] long, i.e. a frame `len` of bodyBytes + 1. */
    private fun jsonFrameOfLen(len: Int): String {
        val prefix = """{"t":"pad","p":""""; val suffix = "\"}"
        return prefix + "x".repeat(len - 1 - prefix.length - suffix.length) + suffix
    }

    private fun Peer.readNonKeepalive(): JSONObject {
        var got: JSONObject
        do { got = readJson() } while (got.getString("t") == "keepalive")
        return got
    }

    @Test fun `before auth a frame len of 4096 is sent and 4097 closes with protocol-error`() {
        val rec = Recorder()
        val l = link(rec, watchdogActiveMs = 10_000)
        l.open(hello())
        val peer = accept()
        peer.readJson()
        val ok = jsonFrameOfLen(4096)
        assertEquals(4096 + 4, FrameCodec.encodeJson(ok).size)
        assertTrue(l.send(ok))
        val got = peer.readNonKeepalive()
        assertEquals("pad", got.getString("t"))
        assertEquals(JSONObject(ok).getString("p"), got.getString("p"))
        assertEquals(emptyList<String>(), rec.reasons)
        assertFalse(l.send(jsonFrameOfLen(4097)))
        assertTrue(rec.closed.await(3, TimeUnit.SECONDS))
        assertEquals(listOf("protocol-error"), rec.reasons)
    }

    @Test fun `after helloAck a frame len of 65536 is sent and 65537 closes with protocol-error`() {
        val rec = Recorder()
        val l = link(rec, watchdogActiveMs = 10_000)
        l.open(hello())
        val peer = accept()
        peer.readJson()
        peer.sendJson("""{"t":"helloAck","inputEnabled":true}""")
        val deadline = System.nanoTime() + 3_000_000_000L
        while (rec.frames.isEmpty() && System.nanoTime() < deadline) Thread.sleep(5)
        assertEquals(1, rec.frames.size)
        val ok = jsonFrameOfLen(65_536)
        assertTrue(l.send(ok))
        val got = peer.readNonKeepalive()
        assertEquals("pad", got.getString("t"))
        assertEquals(JSONObject(ok).getString("p"), got.getString("p"))
        assertEquals(emptyList<String>(), rec.reasons)
        assertFalse(l.send(jsonFrameOfLen(65_537)))
        assertTrue(rec.closed.await(3, TimeUnit.SECONDS))
        assertEquals(listOf("protocol-error"), rec.reasons)
    }

    @Test fun `a failed write closes with link-lost and send returns false`() {
        val rec = Recorder()
        // Long keepalive so the keepalive thread cannot be the one to hit the failed write.
        val l = VideoLink(
            server.localPort, rec, clock = System::currentTimeMillis,
            keepaliveMs = 60_000, watchdogActiveMs = 60_000, watchdogPausedMs = 60_000,
        ).also { links += it }
        l.open(hello())
        accept().readJson()
        l.socketForTest!!.shutdownOutput() // the next write throws IOException deterministically
        assertFalse(l.send(ControlMessages.keepalive()))
        assertTrue(rec.closed.await(3, TimeUnit.SECONDS))
        assertEquals(listOf("link-lost"), rec.reasons)
    }

    @Test fun `a write to a reset peer closes with link-lost`() {
        val rec = Recorder()
        val l = link(rec, watchdogActiveMs = 10_000)
        l.open(hello())
        val peer = accept()
        peer.readJson()
        peer.socket.setSoLinger(true, 0)
        peer.socket.close() // RST
        val deadline = System.nanoTime() + 3_000_000_000L
        while (l.send(ControlMessages.keepalive()) && System.nanoTime() < deadline) Thread.sleep(10)
        assertFalse(l.send(ControlMessages.keepalive()))
        assertTrue(rec.closed.await(3, TimeUnit.SECONDS))
        assertEquals(listOf("link-lost"), rec.reasons)
    }

    @Test fun `watchdog fires while a write is blocked on a full send buffer`() {
        val rec = Recorder()
        val l = link(rec, watchdogActiveMs = 1000)
        val start = System.nanoTime()
        l.open(hello())
        accept() // the helper never reads or sends: ~380 KB of socket buffers fill, then writes block
        val lastOk = AtomicLong(System.nanoTime())
        val senderDone = CountDownLatch(1)
        val big = jsonFrameOfLen(4000)
        Thread {
            while (l.send(big)) lastOk.set(System.nanoTime())
            senderDone.countDown()
        }.apply { isDaemon = true; start() }
        // Wait until the writer has been stuck in a write for 150 ms (the buffers are full)...
        while (System.nanoTime() - lastOk.get() < 150_000_000L && rec.reasons.isEmpty()) Thread.sleep(5)
        // ...while the link is still open, so the watchdog below fires with a write blocked.
        assertEquals("closed before the writer blocked", emptyList<String>(), rec.reasons)
        assertTrue("watchdog parked behind a blocked write", rec.closed.await(3, TimeUnit.SECONDS))
        assertEquals(listOf("link-lost"), rec.reasons)
        val ms = elapsedMs(start, rec.closedAtNanos)
        assertTrue("watchdog fired at $ms ms", ms in 990..3000)
        assertTrue("blocked writer was not released by close", senderDone.await(3, TimeUnit.SECONDS))
        assertTrue(l.threadsForTest().none { it.isAlive })
    }

    @Test fun `closing from the listener on the reader thread does not deadlock`() {
        val reasons = Collections.synchronizedList(mutableListOf<String>())
        val done = CountDownLatch(1)
        lateinit var l: VideoLink
        l = link(object : VideoLink.Listener {
            override fun onFrame(frame: WireFrame) { l.close("user-exit") }
            override fun onClosed(reason: String) { reasons += reason; done.countDown() }
        }, watchdogActiveMs = 10_000)
        l.open(hello())
        val peer = accept()
        peer.readJson()
        peer.sendJson("""{"t":"keepalive"}""")
        assertTrue(done.await(3, TimeUnit.SECONDS))
        assertEquals(listOf("user-exit"), reasons)
        val deadline = System.nanoTime() + 3_000_000_000L
        while (l.threadsForTest().any { it.isAlive } && System.nanoTime() < deadline) Thread.sleep(5)
        assertTrue(l.threadsForTest().none { it.isAlive })
    }
}
