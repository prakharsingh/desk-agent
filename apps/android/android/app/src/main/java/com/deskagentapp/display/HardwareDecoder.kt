/*
 * The configure-retry pattern (full format, then progressively simpler formats when
 * MediaCodec.configure rejects it) is adapted from SideScreen's VideoDecoder.kt.
 * SideScreen is MIT licensed, Copyright (c) 2025 Side Screen; see THIRD_PARTY_NOTICES.md.
 */
package com.deskagentapp.display

import android.media.MediaCodec
import android.media.MediaFormat
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import android.view.Surface
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

data class DecoderStats(val rendered: Long, val dropped: Long, val decodeMsAvg: Double)

/** H.264 decoder rendering straight to a Surface. [onRendered] and [onError] run on the decoder thread. */
class HardwareDecoder(
    private val onRendered: (seq: Long) -> Unit,
    private val onError: (Throwable) -> Unit,
) {
    private val lock = Any()
    private var codec: MediaCodec? = null
    private var thread: HandlerThread? = null

    @Volatile private var active = false
    @Volatile private var released = false

    /** The codec instance whose callbacks count; set before start() so early input indices are kept. */
    @Volatile private var current: MediaCodec? = null

    private val freeInputs = LinkedBlockingQueue<Int>()
    private val queuedAtNs = ConcurrentHashMap<Long, Long>()
    private val rendered = AtomicLong()
    private val dropped = AtomicLong()
    private val decodeNsTotal = AtomicLong()
    private val decodeSamples = AtomicLong()

    private val callback = object : MediaCodec.Callback() {
        override fun onInputBufferAvailable(mc: MediaCodec, index: Int) {
            if (!released && mc === current) freeInputs.offer(index)
        }

        override fun onOutputBufferAvailable(mc: MediaCodec, index: Int, info: MediaCodec.BufferInfo) {
            val render = info.size > 0 && (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0
            if (released || mc !== current) {
                try { mc.releaseOutputBuffer(index, false) } catch (_: IllegalStateException) {}
                return
            }
            try {
                mc.releaseOutputBuffer(index, render)
            } catch (e: IllegalStateException) {
                return // codec released underneath us
            }
            if (!render) return
            val seq = info.presentationTimeUs
            queuedAtNs.remove(seq)?.let {
                decodeNsTotal.addAndGet(System.nanoTime() - it)
                decodeSamples.incrementAndGet()
            }
            // Frames older than this one that never produced output must not accumulate.
            queuedAtNs.keys.removeIf { it <= seq }
            rendered.incrementAndGet()
            if (!released) onRendered(seq)
        }

        override fun onError(mc: MediaCodec, e: MediaCodec.CodecException) {
            Log.e(TAG, "decoder error", e)
            if (!released && mc === current) this@HardwareDecoder.onError(e)
        }

        override fun onOutputFormatChanged(mc: MediaCodec, format: MediaFormat) = Unit
    }

    /** Throws after all retries fail; does not call [onError]. */
    fun configure(surface: Surface, codec: CodecCandidate, w: Int, h: Int, sps: ByteArray, pps: ByteArray) {
        synchronized(lock) {
            check(!released) { "decoder released" }
            check(this.codec == null) { "already configured" }
            val ht = HandlerThread("display-decoder").also { it.start() }
            val handler = Handler(ht.looper)
            var last: Throwable? = null
            // attempt 0: everything; 1: no vendor keys; 2: no vendor keys and no KEY_LOW_LATENCY
            for (attempt in 0..2) {
                var mc: MediaCodec? = null
                try {
                    mc = MediaCodec.createByCodecName(codec.name)
                    mc.setCallback(callback, handler)
                    current = mc
                    mc.configure(buildFormat(w, h, sps, pps, attempt), surface, null, 0)
                    mc.start()
                    this.codec = mc
                    this.thread = ht
                    active = true
                    return
                } catch (e: Exception) {
                    last = e
                    Log.w(TAG, "configure attempt $attempt failed on ${codec.name}", e)
                    current = null
                    freeInputs.clear()
                    try { mc?.release() } catch (_: Exception) {}
                }
            }
            ht.quitSafely()
            throw last ?: IllegalStateException("configure failed")
        }
    }

    private fun buildFormat(w: Int, h: Int, sps: ByteArray, pps: ByteArray, attempt: Int): MediaFormat {
        val f = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, w, h)
        f.setByteBuffer("csd-0", java.nio.ByteBuffer.wrap(withStartCode(sps)))
        f.setByteBuffer("csd-1", java.nio.ByteBuffer.wrap(withStartCode(pps)))
        f.setInteger(MediaFormat.KEY_PRIORITY, 0)
        f.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, w * h)
        if (attempt < 2 && Build.VERSION.SDK_INT >= 30) f.setInteger(MediaFormat.KEY_LOW_LATENCY, 1)
        if (attempt == 0) {
            f.setInteger("vendor.qti-ext-dec-low-latency.enable", 1)
            f.setInteger("vendor.qti-ext-dec-picture-order.enable", 1)
        }
        return f
    }

    private fun withStartCode(nal: ByteArray): ByteArray {
        val has4 = nal.size > 4 && nal[0].toInt() == 0 && nal[1].toInt() == 0 && nal[2].toInt() == 0 && nal[3].toInt() == 1
        val has3 = nal.size > 3 && nal[0].toInt() == 0 && nal[1].toInt() == 0 && nal[2].toInt() == 1
        return if (has4 || has3) nal else byteArrayOf(0, 0, 0, 1) + nal
    }

    /** False when no input buffer frees up within 10 ms or the decoder is not running (counts as dropped). */
    fun queue(annexB: ByteArray, seq: Long): Boolean {
        val mc = synchronized(lock) { if (active) codec else null }
        if (mc == null) { dropped.incrementAndGet(); return false }
        val index = try {
            freeInputs.poll(10, TimeUnit.MILLISECONDS)
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt(); null
        }
        if (index == null) { dropped.incrementAndGet(); return false }
        return try {
            val buf = mc.getInputBuffer(index)
            if (buf == null || buf.capacity() < annexB.size) {
                freeInputs.offer(index)
                dropped.incrementAndGet()
                false
            } else {
                buf.clear()
                buf.put(annexB)
                queuedAtNs[seq] = System.nanoTime()
                mc.queueInputBuffer(index, 0, annexB.size, seq, 0)
                true
            }
        } catch (e: Exception) { // released concurrently or codec error
            queuedAtNs.remove(seq)
            dropped.incrementAndGet()
            false
        }
    }

    /** Idempotent; safe after a failed configure. */
    fun release() {
        val mc: MediaCodec?
        val ht: HandlerThread?
        synchronized(lock) {
            if (released) return
            released = true
            active = false
            current = null
            mc = codec; ht = thread
            codec = null; thread = null
        }
        try { mc?.stop() } catch (_: Exception) {}
        try { mc?.release() } catch (_: Exception) {}
        ht?.quitSafely()
        freeInputs.clear()
        queuedAtNs.clear()
    }

    fun stats(): DecoderStats {
        val n = decodeSamples.get()
        val avg = if (n == 0L) 0.0 else decodeNsTotal.get() / n / 1_000_000.0
        return DecoderStats(rendered.get(), dropped.get(), avg)
    }

    private companion object { const val TAG = "HardwareDecoder" }
}
