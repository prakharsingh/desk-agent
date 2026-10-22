package com.deskagentapp.display

import android.view.View
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.annotations.ReactPropGroup
import io.mockk.mockk
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Records what the module feeds the session; no threads. */
private class FakeHost : DisplaySessionHost {
    val inputs = mutableListOf<SessionInput>()
    var lastEvents: DisplayEvents? = null
    val offered = mutableListOf<String>()
    override fun nowMs(): Long = 1234
    override fun input(input: SessionInput) { inputs += input }
    override fun tokenOffered(sessionId: String) { offered += sessionId }
    override fun setEvents(events: DisplayEvents?) { lastEvents = events }
    var sizeRequests = 0
    override fun requestSize() { sizeRequests++ }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class DisplayModuleTest {
    private val ctx = mockk<ReactApplicationContext>(relaxed = true)

    @Before fun setUp() = DisplayTokenHolder.clear()
    @After fun tearDown() { DisplayTokenHolder.clear(); DisplayTokenHolder.setListener(null) }

    @Test fun `getName is DisplayModule`() {
        assertEquals("DisplayModule", DisplayModule(ctx, FakeHost()).name)
    }

    @Test fun `start forwards the session id and an integer port`() {
        val host = FakeHost()
        DisplayModule(ctx, host).start("s1", 8788.0)
        assertEquals(listOf<SessionInput>(SessionInput.Start("s1", 8788, 1234)), host.inputs)
    }

    @Test fun `start takes a token that arrived before it`() {
        val host = FakeHost()
        val module = DisplayModule(ctx, host)
        DisplayTokenHolder.offer("s1", "secret-token")
        module.start("s1", 8788.0)
        assertEquals(
            listOf(SessionInput.Start("s1", 8788, 1234), SessionInput.TokenAvailable("s1", "secret-token")),
            host.inputs,
        )
        // single use: the holder no longer has it
        assertEquals(null, DisplayTokenHolder.take("s1"))
    }

    @Test fun `later token offers reach the session through the holder listener`() {
        val host = FakeHost()
        DisplayModule(ctx, host)
        DisplayTokenHolder.offer("s2", "t2")
        assertEquals(listOf("s2"), host.offered)
    }

    @Test fun `requestSize asks the session to re-emit`() {
        val host = FakeHost()
        DisplayModule(ctx, host).requestSize()
        assertEquals(1, host.sizeRequests)
    }

    @Test fun `stop feeds UserStop`() {
        val host = FakeHost()
        DisplayModule(ctx, host).stop()
        assertEquals(listOf<SessionInput>(SessionInput.UserStop), host.inputs)
    }

    @Test fun `stateEventMap omits null fields`() {
        assertEquals(mapOf("state" to "connecting"), DisplayModule.stateEventMap(SessionAction.Emit("connecting")))
        assertEquals(
            mapOf("state" to "error", "reason" to "decoder-error"),
            DisplayModule.stateEventMap(SessionAction.Emit("error", "decoder-error")),
        )
        assertEquals(
            mapOf("state" to "streaming", "inputEnabled" to false),
            DisplayModule.stateEventMap(SessionAction.Emit("streaming", inputEnabled = false)),
        )
    }

    @Test fun `sizeEventMap reports orientation`() {
        val land = DisplayModule.sizeEventMap(2340, 1080, 402.0f)
        assertEquals(2340, land["w"]); assertEquals(1080, land["h"])
        assertEquals("landscape", land["orientation"])
        assertEquals(402.0, (land["dpi"] as Number).toDouble(), 0.001)
        assertEquals("portrait", DisplayModule.sizeEventMap(1080, 2340, 402.0f)["orientation"])
    }

    /** A SimpleViewManager that adds nothing: its props are what every SimpleViewManager inherits. */
    private class BareViewManager : SimpleViewManager<View>() {
        override fun getName() = "Bare"
        override fun createViewInstance(reactContext: ThemedReactContext) = View(reactContext)
    }

    @Test fun `the view manager is named DeskAgentDisplayView and declares no props`() {
        val vm = DisplayViewManager()
        assertEquals("DeskAgentDisplayView", vm.name)
        // SimpleViewManager inherits BaseViewManager's style props (opacity, transform, ...), so
        // `nativeProps` is never literally empty; "no props" = nothing beyond that baseline.
        assertEquals(BareViewManager().nativeProps, vm.nativeProps)
        val declared = DisplayViewManager::class.java.declaredMethods.filter {
            it.isAnnotationPresent(ReactProp::class.java) || it.isAnnotationPresent(ReactPropGroup::class.java)
        }
        assertTrue(declared.isEmpty())
    }
}
