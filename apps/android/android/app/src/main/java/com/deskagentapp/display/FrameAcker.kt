package com.deskagentapp.display

/**
 * Turns "this video frame is finished" (rendered or dropped) into Contract D's cumulative ack:
 * a seq is acked only when it is above the last one acked, so acks never decrease.
 * Config frames (seq 0) never reach it. Not thread-safe: used on the display-session thread only.
 */
class FrameAcker {
    private var lastAcked = 0L

    /** The seq to send as `ack(seq)`, or null when it would not advance the ack. */
    fun finished(seq: Long): Long? {
        if (seq <= lastAcked) return null
        lastAcked = seq
        return seq
    }
}
