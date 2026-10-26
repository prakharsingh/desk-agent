package com.deskagentapp.display

import android.content.Intent
import android.util.Log
import java.security.MessageDigest

/**
 * Holds the one-shot display token that Mac core delivers over adb
 * (`am start ... --es displayToken <t> --es displaySessionId <s>`).
 * The token value is never logged.
 */
object DisplayTokenHolder {
    const val EXTRA_TOKEN = "displayToken"
    const val EXTRA_SESSION_ID = "displaySessionId"
    private const val TAG = "DeskAgentDisplay"

    /** Held tokens are kept per sessionId; beyond this many, the oldest is evicted. */
    internal const val MAX_HELD = 4

    private val lock = Any()
    // Insertion-ordered so the eldest entry is the one evicted. Keyed by sessionId, so an
    // offer for an unrelated sessionId (e.g. a rogue app firing the exported activity)
    // cannot replace the real session's token; it can only age out after MAX_HELD others.
    private val held = LinkedHashMap<String, String>()
    // SHA-256 of the last accepted pair (never the token itself); survives take() so a
    // resent identical intent (core restart) cannot re-park the token or re-fire the listener.
    private var lastDigest: ByteArray? = null
    private var listener: ((sessionId: String) -> Unit)? = null

    /**
     * Holds [token] for [sessionId], replacing only that session's older token. An identical
     * repeat of the last accepted pair is a no-op.
     */
    fun offer(sessionId: String, token: String) {
        val l: ((String) -> Unit)?
        synchronized(lock) {
            // Deliberate: only an identical pair is a repeat; a new token for the same sessionId is accepted.
            val digest = digest(sessionId, token)
            if (lastDigest?.let { MessageDigest.isEqual(it, digest) } == true) return
            held.remove(sessionId)
            held[sessionId] = token
            while (held.size > MAX_HELD) held.remove(held.keys.first())
            lastDigest = digest
            l = listener
        }
        Log.i(TAG, "token received for $sessionId")
        l?.invoke(sessionId)
    }

    /** Single-use: returns and removes the token held for [sessionId] only; others are kept. */
    fun take(sessionId: String): String? = synchronized(lock) { held.remove(sessionId) }

    fun clear() = synchronized(lock) {
        held.clear(); lastDigest = null
    }

    internal fun heldCountForTest(): Int = synchronized(lock) { held.size }

    private fun digest(sessionId: String, token: String): ByteArray =
        MessageDigest.getInstance("SHA-256").run {
            update(sessionId.toByteArray(Charsets.UTF_8))
            update(0)
            update(token.toByteArray(Charsets.UTF_8))
            digest()
        }

    /**
     * The listener runs synchronously on the thread that calls [offer] (the main thread
     * when fed from MainActivity); consumers must hop threads for blocking work.
     */
    fun setListener(listener: ((sessionId: String) -> Unit)?) = synchronized(lock) {
        this.listener = listener
    }

    /** Both extras present -> offer and strip them; otherwise a no-op (never clears a held token). */
    fun readFromIntent(intent: Intent?): Boolean {
        if (intent == null) return false
        val token = intent.getStringExtra(EXTRA_TOKEN)
        val sessionId = intent.getStringExtra(EXTRA_SESSION_ID)
        if (token.isNullOrEmpty() || sessionId.isNullOrEmpty()) return false
        intent.removeExtra(EXTRA_TOKEN)
        intent.removeExtra(EXTRA_SESSION_ID)
        offer(sessionId, token)
        return true
    }
}
