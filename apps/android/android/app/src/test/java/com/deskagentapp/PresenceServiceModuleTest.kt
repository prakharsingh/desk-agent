package com.deskagentapp

import android.content.Intent
import com.facebook.react.bridge.ReactApplicationContext
import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import io.mockk.verify
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

// The ReactApplicationContext itself is a MockK mock (its superclass has a
// long list of abstract members that make a hand-written test subclass
// impractical), but PresenceServiceModule.start()/stop() build a real
// android.content.Intent internally, and Intent/ComponentName's real method
// bodies are stubbed to throw "not mocked" under the plain unit-test
// android.jar. @RunWith(RobolectricTestRunner) swaps in Robolectric's
// shadowed, actually-working Intent/ComponentName implementations -- Intent
// only ever calls .getPackageName() on the context argument, which the mock
// happily answers, so no real Context/Application is needed here.
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class PresenceServiceModuleTest {
  @Test
  fun `getName reports the module name the JS side looks up via NativeModules PresenceService`() {
    val reactContext = mockk<ReactApplicationContext>(relaxed = true)
    assertEquals("PresenceService", PresenceServiceModule(reactContext).name)
  }

  @Test
  fun `start launches PresenceForegroundService as a foreground service`() {
    val reactContext = mockk<ReactApplicationContext>(relaxed = true)
    val intentSlot = slot<Intent>()
    every { reactContext.startForegroundService(capture(intentSlot)) } returns null

    PresenceServiceModule(reactContext).start()

    verify(exactly = 1) { reactContext.startForegroundService(any()) }
    assertEquals(PresenceForegroundService::class.java.name, intentSlot.captured.component?.className)
  }

  @Test
  fun `stop targets PresenceForegroundService for shutdown`() {
    val reactContext = mockk<ReactApplicationContext>(relaxed = true)
    val intentSlot = slot<Intent>()
    every { reactContext.stopService(capture(intentSlot)) } returns true

    PresenceServiceModule(reactContext).stop()

    verify(exactly = 1) { reactContext.stopService(any()) }
    assertEquals(PresenceForegroundService::class.java.name, intentSlot.captured.component?.className)
  }

  @Test
  fun `start does not also stop the service`() {
    val reactContext = mockk<ReactApplicationContext>(relaxed = true)

    PresenceServiceModule(reactContext).start()

    verify(exactly = 0) { reactContext.stopService(any()) }
  }
}
