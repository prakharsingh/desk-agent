package com.deskagentapp.display

sealed class SessionState {
    object Idle : SessionState()
    data class AwaitingToken(val sessionId: String, val port: Int, val deadlineMs: Long) : SessionState()
    data class Connecting(val sessionId: String) : SessionState()
    /** [side]: from helloAck, for the JS placement hint; re-emitted with every streaming state. */
    data class Streaming(val sessionId: String, val inputEnabled: Boolean, val side: String? = null) : SessionState()
    data class Ended(val reason: String) : SessionState()
}

sealed class SessionInput {
    data class Start(val sessionId: String, val port: Int, val nowMs: Long) : SessionInput()
    data class TokenAvailable(val sessionId: String, val token: String) : SessionInput()
    data class SurfaceReady(val w: Int, val h: Int) : SessionInput()
    /** The ready surface changed size (rotation). Fed instead of [SurfaceReady] while a surface is held. */
    data class SurfaceResized(val w: Int, val h: Int) : SessionInput()
    object SurfaceLost : SessionInput()
    data class HelloAck(val inputEnabled: Boolean, val side: String? = null) : SessionInput()
    /** The helper's `inputState`: touch input turned on or off mid-session (Accessibility granted/revoked). */
    data class InputAccess(val enabled: Boolean) : SessionInput()
    data class LinkClosed(val reason: String) : SessionInput()
    data class HelperEnd(val reason: String) : SessionInput()
    /** No usable hardware decoder, or configure failed after all fallbacks. Per-frame decode errors are not this. */
    object DecoderFailed : SessionInput()
    object UserStop : SessionInput()
    data class Tick(val nowMs: Long) : SessionInput()
}

sealed class SessionAction {
    data class OpenLink(val port: Int, val token: String, val sessionId: String) : SessionAction()
    data class SendBye(val reason: String) : SessionAction()
    /** Contract D `resize`: the helper renegotiates the stream; the session continues. */
    data class SendResize(val w: Int, val h: Int) : SessionAction()
    object CloseLink : SessionAction()
    object ReleaseDecoder : SessionAction()
    object ClearToken : SessionAction()
    /** state is one of connecting|streaming|paused|ended|error. */
    data class Emit(val state: String, val reason: String? = null, val inputEnabled: Boolean? = null, val side: String? = null) : SessionAction()
}

/**
 * Pure lifecycle of one phone display session. No Android APIs, no threads: the glue feeds inputs
 * and executes the returned actions. Action order is always SendBye, CloseLink, ReleaseDecoder,
 * ClearToken, Emit. A rotation never ends the session: while Streaming, a new surface size is
 * [SessionAction.SendResize] (before Streaming it only changes the size the hello will carry).
 */
class DisplaySessionMachine(private val tokenWaitMs: Long = 5000) {
    var state: SessionState = SessionState.Idle
        private set

    private var surfaceReady = false
    private var pendingToken: String? = null
    /** Current surface size, and the size the helper last heard (hello, then each resize). */
    private var size: Pair<Int, Int>? = null
    private var sentSize: Pair<Int, Int>? = null

    fun handle(input: SessionInput): List<SessionAction> {
        val s = state
        // Surface readiness is tracked silently even once Ended so a following Start sees the truth.
        if (s is SessionState.Ended) {
            when (input) {
                is SessionInput.Start -> return start(input)
                is SessionInput.SurfaceReady -> { surfaceReady = true; size = input.w to input.h }
                is SessionInput.SurfaceResized -> size = input.w to input.h
                SessionInput.SurfaceLost -> surfaceReady = false
                else -> Unit
            }
            return emptyList()
        }
        return when (input) {
            is SessionInput.Start -> start(input)
            is SessionInput.TokenAvailable -> {
                if (s is SessionState.AwaitingToken && s.sessionId == input.sessionId) {
                    pendingToken = input.token
                    tryOpen(s)
                } else emptyList()
            }
            is SessionInput.SurfaceReady -> {
                surfaceReady = true
                size = input.w to input.h
                if (s is SessionState.AwaitingToken) tryOpen(s) else emptyList()
            }
            is SessionInput.SurfaceResized -> {
                size = input.w to input.h
                // Before Streaming the hello (sent or not yet) is reconciled at helloAck.
                if (s is SessionState.Streaming) syncSize() else emptyList()
            }
            SessionInput.SurfaceLost -> {
                surfaceReady = false
                if (s is SessionState.Connecting || s is SessionState.Streaming) {
                    end("grace-expired", "ended", bye = "grace-expired", closeLink = true)
                } else emptyList()
            }
            is SessionInput.HelloAck -> {
                if (s is SessionState.Connecting) {
                    state = SessionState.Streaming(s.sessionId, input.inputEnabled, input.side)
                    // A rotation between the hello and its ack: tell the helper now.
                    listOf(SessionAction.Emit("streaming", inputEnabled = input.inputEnabled, side = input.side)) + syncSize()
                } else emptyList()
            }
            is SessionInput.InputAccess -> {
                if (s is SessionState.Streaming && s.inputEnabled != input.enabled) {
                    state = s.copy(inputEnabled = input.enabled)
                    listOf(SessionAction.Emit("streaming", inputEnabled = input.enabled, side = s.side))
                } else emptyList()
            }
            // The link itself is gone, so it is not closed again.
            is SessionInput.LinkClosed -> when (s) {
                // Lost before helloAck (helper rejected the hello, was not accepting, or died):
                // always a connect failure, so the user sees why and JS tells core to stop.
                is SessionState.Connecting -> end(VideoLink.REASON_CONNECT_FAILED, "error")
                is SessionState.Streaming -> end(input.reason, if (input.reason in LINK_ERRORS) "error" else "ended")
                else -> emptyList()
            }
            // The link forwards the helper's end without closing itself, so close it here.
            is SessionInput.HelperEnd -> {
                if (s is SessionState.Idle) emptyList()
                else end(
                    input.reason,
                    if (input.reason in HELPER_ERRORS) "error" else "ended",
                    closeLink = s is SessionState.Connecting || s is SessionState.Streaming,
                    releaseDecoder = s !is SessionState.AwaitingToken,
                )
            }
            SessionInput.DecoderFailed -> {
                if (s is SessionState.Connecting || s is SessionState.Streaming) {
                    end("decoder-error", "error", bye = "decoder-error", closeLink = true)
                } else emptyList()
            }
            SessionInput.UserStop -> when (s) {
                is SessionState.AwaitingToken -> end("user-exit", "ended", releaseDecoder = false)
                is SessionState.Connecting, is SessionState.Streaming ->
                    end("user-exit", "ended", bye = "user-exit", closeLink = true)
                else -> emptyList()
            }
            is SessionInput.Tick -> {
                if (s is SessionState.AwaitingToken && input.nowMs > s.deadlineMs) {
                    state = SessionState.Ended("token-timeout")
                    pendingToken = null
                    listOf(SessionAction.ClearToken, SessionAction.Emit("error", "token-timeout"))
                } else emptyList()
            }
        }
    }

    private fun start(input: SessionInput.Start): List<SessionAction> {
        val s = state
        val actions = mutableListOf<SessionAction>()
        val activeId = when (s) {
            is SessionState.AwaitingToken -> s.sessionId
            is SessionState.Connecting -> s.sessionId
            is SessionState.Streaming -> s.sessionId
            else -> null
        }
        if (activeId != null) {
            if (activeId == input.sessionId) return emptyList()
            // Supersede silently: the old session gets no Emit.
            if (s is SessionState.Connecting || s is SessionState.Streaming) actions += SessionAction.CloseLink
            actions += SessionAction.ReleaseDecoder
            actions += SessionAction.ClearToken
        }
        pendingToken = null
        state = SessionState.AwaitingToken(input.sessionId, input.port, input.nowMs + tokenWaitMs)
        actions += SessionAction.Emit("connecting")
        return actions
    }

    private fun tryOpen(s: SessionState.AwaitingToken): List<SessionAction> {
        val token = pendingToken
        if (token == null || !surfaceReady) return emptyList()
        state = SessionState.Connecting(s.sessionId)
        sentSize = size   // the hello carries the current surface size
        return listOf(SessionAction.OpenLink(s.port, token, s.sessionId))
    }

    /** While Streaming: a resize when the surface differs from what the helper last heard. */
    private fun syncSize(): List<SessionAction> {
        val now = size ?: return emptyList()
        if (now == sentSize) return emptyList()
        sentSize = now
        return listOf(SessionAction.SendResize(now.first, now.second))
    }

    private fun end(
        reason: String,
        emitState: String,
        bye: String? = null,
        closeLink: Boolean = false,
        releaseDecoder: Boolean = true,
    ): List<SessionAction> {
        state = SessionState.Ended(reason)
        pendingToken = null
        val actions = mutableListOf<SessionAction>()
        if (bye != null) actions += SessionAction.SendBye(bye)
        if (closeLink) actions += SessionAction.CloseLink
        if (releaseDecoder) actions += SessionAction.ReleaseDecoder
        actions += SessionAction.ClearToken
        actions += SessionAction.Emit(emitState, reason)
        return actions
    }

    private companion object {
        val LINK_ERRORS = setOf(VideoLink.REASON_CONNECT_FAILED, VideoLink.REASON_PROTOCOL_ERROR)
        // display-offline: macOS switched the display off mid-session (Control Center); shown, not a silent exit.
        val HELPER_ERRORS = setOf("version-mismatch", VideoLink.REASON_PROTOCOL_ERROR, "capture-failed", "capture-unavailable", "display-offline")
    }
}
