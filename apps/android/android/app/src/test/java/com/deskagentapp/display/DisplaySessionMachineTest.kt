package com.deskagentapp.display

import com.deskagentapp.display.SessionAction.CloseLink
import com.deskagentapp.display.SessionAction.ClearToken
import com.deskagentapp.display.SessionAction.Emit
import com.deskagentapp.display.SessionAction.OpenLink
import com.deskagentapp.display.SessionAction.ReleaseDecoder
import com.deskagentapp.display.SessionAction.SendBye
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DisplaySessionMachineTest {
    private fun m() = DisplaySessionMachine()

    private fun DisplaySessionMachine.toConnecting(): DisplaySessionMachine {
        handle(SessionInput.Start("s1", 9000, 0))
        handle(SessionInput.SurfaceReady(1080, 2400))
        handle(SessionInput.TokenAvailable("s1", "tok"))
        return this
    }

    private fun DisplaySessionMachine.toStreaming(): DisplaySessionMachine {
        toConnecting()
        handle(SessionInput.HelloAck(true))
        return this
    }

    @Test fun `start waits for the token`() {
        val m = m()
        val a = m.handle(SessionInput.Start("s1", 9000, 100))
        assertEquals(listOf<SessionAction>(Emit("connecting")), a)
        assertEquals(SessionState.AwaitingToken("s1", 9000, 5100), m.state)
    }

    @Test fun `a token offered before Start is used`() {
        val m = m()
        m.handle(SessionInput.Start("s1", 9000, 100))
        assertEquals(emptyList<SessionAction>(), m.handle(SessionInput.TokenAvailable("s1", "tok")))
        assertEquals(listOf<SessionAction>(OpenLink(9000, "tok", "s1")), m.handle(SessionInput.SurfaceReady(1, 2)))
        assertEquals(emptyList<SessionAction>(), m.handle(SessionInput.Tick(100 + 6000)))
        assertEquals(SessionState.Connecting("s1"), m.state)
    }

    @Test fun `opens the link only when token and surface are both ready, in either order`() {
        val a = m()
        a.handle(SessionInput.Start("s1", 9000, 0))
        assertEquals(emptyList<SessionAction>(), a.handle(SessionInput.SurfaceReady(1, 2)))
        assertEquals(listOf<SessionAction>(OpenLink(9000, "tok", "s1")), a.handle(SessionInput.TokenAvailable("s1", "tok")))
        assertEquals(SessionState.Connecting("s1"), a.state)

        val b = m()
        b.handle(SessionInput.Start("s1", 9000, 0))
        assertEquals(emptyList<SessionAction>(), b.handle(SessionInput.TokenAvailable("s1", "tok")))
        assertTrue(b.state is SessionState.AwaitingToken)
        assertEquals(listOf<SessionAction>(OpenLink(9000, "tok", "s1")), b.handle(SessionInput.SurfaceReady(1, 2)))
    }

    @Test fun `ignores a token for another session`() {
        val m = m()
        m.handle(SessionInput.Start("s1", 9000, 0))
        m.handle(SessionInput.SurfaceReady(1, 2))
        assertEquals(emptyList<SessionAction>(), m.handle(SessionInput.TokenAvailable("other", "tok")))
        assertTrue(m.state is SessionState.AwaitingToken)
    }

    @Test fun `times out without a token after 5s`() {
        val m = m()
        m.handle(SessionInput.Start("s1", 9000, 0))
        assertEquals(emptyList<SessionAction>(), m.handle(SessionInput.Tick(4999)))
        assertEquals(emptyList<SessionAction>(), m.handle(SessionInput.Tick(5000)))
        assertEquals(
            listOf(ClearToken, Emit("error", "token-timeout")),
            m.handle(SessionInput.Tick(5001)),
        )
        assertEquals(SessionState.Ended("token-timeout"), m.state)
    }

    @Test fun `hello ack moves to streaming with the input flag`() {
        val m = m().toConnecting()
        val a = m.handle(SessionInput.HelloAck(true))
        assertEquals(listOf<SessionAction>(Emit("streaming", inputEnabled = true)), a)
        assertEquals(SessionState.Streaming("s1", true), m.state)
    }

    @Test fun `hello ack outside connecting is ignored`() {
        val idle = m()
        assertEquals(emptyList<SessionAction>(), idle.handle(SessionInput.HelloAck(true)))
        assertEquals(SessionState.Idle, idle.state)
        val waiting = m()
        waiting.handle(SessionInput.Start("s1", 9000, 0))
        assertEquals(emptyList<SessionAction>(), waiting.handle(SessionInput.HelloAck(true)))
        val streaming = m().toStreaming()
        assertEquals(emptyList<SessionAction>(), streaming.handle(SessionInput.HelloAck(false)))
        assertEquals(SessionState.Streaming("s1", true), streaming.state)
    }

    @Test fun `losing the surface ends the session with grace-expired (phase 3)`() {
        for (m in listOf(m().toConnecting(), m().toStreaming())) {
            val a = m.handle(SessionInput.SurfaceLost)
            assertEquals(
                listOf(SendBye("grace-expired"), CloseLink, ReleaseDecoder, ClearToken, Emit("ended", "grace-expired")),
                a,
            )
            assertEquals(SessionState.Ended("grace-expired"), m.state)
        }
    }

    @Test fun `surface lost while awaiting token only clears readiness`() {
        val m = m()
        m.handle(SessionInput.Start("s1", 9000, 0))
        m.handle(SessionInput.SurfaceReady(1, 2))
        assertEquals(emptyList<SessionAction>(), m.handle(SessionInput.SurfaceLost))
        assertTrue(m.state is SessionState.AwaitingToken)
        // readiness cleared: a token alone must not open the link
        assertEquals(emptyList<SessionAction>(), m.handle(SessionInput.TokenAvailable("s1", "tok")))
        assertEquals(listOf<SessionAction>(OpenLink(9000, "tok", "s1")), m.handle(SessionInput.SurfaceReady(1, 2)))
    }

    @Test fun `surface ready while streaming is a no-op`() {
        val m = m().toStreaming()
        assertEquals(emptyList<SessionAction>(), m.handle(SessionInput.SurfaceReady(10, 20)))
        assertEquals(SessionState.Streaming("s1", true), m.state)
    }

    @Test fun `link loss ends with link-lost`() {
        val m = m().toStreaming()
        val a = m.handle(SessionInput.LinkClosed("link-lost"))
        assertEquals(listOf(ReleaseDecoder, ClearToken, Emit("ended", "link-lost")), a)
        assertEquals(SessionState.Ended("link-lost"), m.state)
    }

    @Test fun `any link close before helloAck is a connect-failed error`() {
        for (reason in listOf("link-lost", "connect-failed", "protocol-error", "something-new")) {
            val m = m().toConnecting()
            assertEquals(
                reason,
                listOf(ReleaseDecoder, ClearToken, Emit("error", "connect-failed")),
                m.handle(SessionInput.LinkClosed(reason)),
            )
            assertEquals(reason, SessionState.Ended("connect-failed"), m.state)
        }
    }

    @Test fun `link-lost while streaming is still a plain ended`() {
        val m = m().toStreaming()
        assertEquals(listOf(ReleaseDecoder, ClearToken, Emit("ended", "link-lost")), m.handle(SessionInput.LinkClosed("link-lost")))
    }

    @Test fun `connect failure is reported as an error`() {
        val m = m().toConnecting()
        assertEquals(
            listOf(ReleaseDecoder, ClearToken, Emit("error", "connect-failed")),
            m.handle(SessionInput.LinkClosed("connect-failed")),
        )
        val p = m().toStreaming()
        assertEquals(
            listOf(ReleaseDecoder, ClearToken, Emit("error", "protocol-error")),
            p.handle(SessionInput.LinkClosed("protocol-error")),
        )
    }

    @Test fun `helper end with version-mismatch is reported as an error`() {
        for (r in listOf("version-mismatch", "protocol-error", "capture-failed", "capture-unavailable")) {
            val m = m().toStreaming()
            assertEquals(
                listOf(CloseLink, ReleaseDecoder, ClearToken, Emit("error", r)),
                m.handle(SessionInput.HelperEnd(r)),
            )
            assertEquals(SessionState.Ended(r), m.state)
        }
    }

    @Test fun `helper end with an ordinary reason closes the link and reports ended`() {
        val m = m().toStreaming()
        assertEquals(
            listOf(CloseLink, ReleaseDecoder, ClearToken, Emit("ended", "stopped")),
            m.handle(SessionInput.HelperEnd("stopped")),
        )
    }

    @Test fun `helper end while awaiting the token has no link to close`() {
        val m = m()
        m.handle(SessionInput.Start("s1", 9000, 0))
        assertEquals(
            listOf(ClearToken, Emit("error", "capture-failed")),
            m.handle(SessionInput.HelperEnd("capture-failed")),
        )
        assertEquals(SessionState.Ended("capture-failed"), m.state)
    }

    @Test fun `first end reason wins`() {
        val m = m().toStreaming()
        val first = m.handle(SessionInput.HelperEnd("capture-failed"))
        assertEquals(1, first.count { it is Emit })
        assertEquals(emptyList<SessionAction>(), m.handle(SessionInput.LinkClosed("link-lost")))
        assertEquals(SessionState.Ended("capture-failed"), m.state)
    }

    @Test fun `decoder failure ends with decoder-error`() {
        val m = m().toStreaming()
        assertEquals(
            listOf(SendBye("decoder-error"), CloseLink, ReleaseDecoder, ClearToken, Emit("error", "decoder-error")),
            m.handle(SessionInput.DecoderFailed),
        )
        assertEquals(SessionState.Ended("decoder-error"), m.state)
    }

    @Test fun `user stop sends bye then closes`() {
        val m = m().toStreaming()
        assertEquals(
            listOf(SendBye("user-exit"), CloseLink, ReleaseDecoder, ClearToken, Emit("ended", "user-exit")),
            m.handle(SessionInput.UserStop),
        )
        assertEquals(SessionState.Ended("user-exit"), m.state)
    }

    @Test fun `user stop while awaiting the token has no link to say bye to`() {
        val m = m()
        m.handle(SessionInput.Start("s1", 9000, 0))
        assertEquals(listOf(ClearToken, Emit("ended", "user-exit")), m.handle(SessionInput.UserStop))
        assertEquals(SessionState.Ended("user-exit"), m.state)
    }

    @Test fun `user stop in idle or ended does nothing`() {
        val idle = m()
        assertEquals(emptyList<SessionAction>(), idle.handle(SessionInput.UserStop))
        assertEquals(SessionState.Idle, idle.state)
        val ended = m().toStreaming()
        ended.handle(SessionInput.UserStop)
        assertEquals(emptyList<SessionAction>(), ended.handle(SessionInput.UserStop))
        assertEquals(SessionState.Ended("user-exit"), ended.state)
    }

    @Test fun `ended ignores late inputs until a new start`() {
        val m = m().toStreaming()
        m.handle(SessionInput.LinkClosed("link-lost"))
        for (i in listOf(
            SessionInput.TokenAvailable("s1", "t"), SessionInput.SurfaceLost, SessionInput.HelloAck(true),
            SessionInput.DecoderFailed, SessionInput.Tick(99999), SessionInput.HelperEnd("x"),
        )) {
            assertEquals(emptyList<SessionAction>(), m.handle(i))
            assertEquals(SessionState.Ended("link-lost"), m.state)
        }
        assertEquals(listOf<SessionAction>(Emit("connecting")), m.handle(SessionInput.Start("s2", 9001, 10)))
        assertEquals(SessionState.AwaitingToken("s2", 9001, 5010), m.state)
    }

    @Test fun `start for the same session while active is a no-op`() {
        val awaiting = m()
        awaiting.handle(SessionInput.Start("s1", 9000, 0))
        assertEquals(emptyList<SessionAction>(), awaiting.handle(SessionInput.Start("s1", 9000, 50)))
        assertEquals(SessionState.AwaitingToken("s1", 9000, 5000), awaiting.state)
        val connecting = m().toConnecting()
        assertEquals(emptyList<SessionAction>(), connecting.handle(SessionInput.Start("s1", 9000, 50)))
        val streaming = m().toStreaming()
        assertEquals(emptyList<SessionAction>(), streaming.handle(SessionInput.Start("s1", 9000, 50)))
        assertEquals(SessionState.Streaming("s1", true), streaming.state)
    }

    @Test fun `start for a different session tears down the old one silently`() {
        val awaiting = m()
        awaiting.handle(SessionInput.Start("s1", 9000, 0))
        assertEquals(
            listOf(ReleaseDecoder, ClearToken, Emit("connecting")),
            awaiting.handle(SessionInput.Start("s2", 9001, 10)),
        )
        assertEquals(SessionState.AwaitingToken("s2", 9001, 5010), awaiting.state)

        for (m in listOf(m().toConnecting(), m().toStreaming())) {
            assertEquals(
                listOf(CloseLink, ReleaseDecoder, ClearToken, Emit("connecting")),
                m.handle(SessionInput.Start("s2", 9001, 10)),
            )
            assertEquals(SessionState.AwaitingToken("s2", 9001, 5010), m.state)
            // surface readiness carried over; the old token is gone
            assertEquals(
                listOf<SessionAction>(OpenLink(9001, "new", "s2")),
                m.handle(SessionInput.TokenAvailable("s2", "new")),
            )
        }
    }
}
