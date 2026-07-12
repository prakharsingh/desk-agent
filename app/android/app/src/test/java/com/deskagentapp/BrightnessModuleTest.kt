package com.deskagentapp

import android.app.Activity
import android.app.Application
import android.provider.Settings
import android.view.Window
import android.view.WindowManager
import androidx.test.core.app.ApplicationProvider
import com.facebook.react.bridge.Promise
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

// Robolectric only for real android.view.WindowManager.LayoutParams and
// android.provider.Settings.System behavior (both throw "not mocked" under
// the plain unit-test android.jar, same root cause as Intent/ComponentName in
// PresenceServiceModuleTest). ReactApplicationContext/Activity/Window are
// still plain MockK mocks -- the module only ever calls a handful of specific
// methods on them, which mocking is a much lighter way to control than
// standing up a real Activity via Robolectric's activity lifecycle.
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class BrightnessModuleTest {

  // Wires a mocked ReactApplicationContext/Activity/Window together so
  // getBrightnessLevel/setBrightnessLevel's `activity.window.attributes`
  // round-trips through one real, shared WindowManager.LayoutParams instance
  // -- the same relationship the real Android window object has.
  private fun newModuleWithWindow(): Pair<BrightnessModule, WindowManager.LayoutParams> {
    val app = ApplicationProvider.getApplicationContext<Application>()
    val reactContext = mockk<ReactApplicationContext>(relaxed = true)
    every { reactContext.contentResolver } returns app.contentResolver

    val activity = mockk<Activity>(relaxed = true)
    every { activity.runOnUiThread(any()) } answers { firstArg<Runnable>().run() }
    val window = mockk<Window>(relaxed = true)
    val layoutParams = WindowManager.LayoutParams()
    every { window.attributes } returns layoutParams
    every { activity.window } returns window
    every { reactContext.currentActivity } returns activity

    return BrightnessModule(reactContext) to layoutParams
  }

  @Test
  fun `getName reports the module name the JS side looks up via NativeModules Brightness`() {
    val reactContext = mockk<ReactApplicationContext>(relaxed = true)
    assertEquals("Brightness", BrightnessModule(reactContext).name)
  }

  @Test
  fun `getBrightnessLevel rejects with NO_ACTIVITY when there is no current activity`() {
    val reactContext = mockk<ReactApplicationContext>(relaxed = true)
    every { reactContext.currentActivity } returns null
    val promise = mockk<Promise>(relaxed = true)

    BrightnessModule(reactContext).getBrightnessLevel(promise)

    verify(exactly = 1) { promise.reject("NO_ACTIVITY", any<String>()) }
  }

  @Test
  fun `getBrightnessLevel resolves with the current window override when one is set`() {
    val (module, layoutParams) = newModuleWithWindow()
    layoutParams.screenBrightness = 0.42f
    val promise = mockk<Promise>(relaxed = true)
    val resolved = slot<Any>()
    every { promise.resolve(capture(resolved)) } returns Unit

    module.getBrightnessLevel(promise)

    assertEquals(0.42, resolved.captured as Double, 0.001)
  }

  @Test
  fun `getBrightnessLevel falls back to the system brightness setting when no window override is set`() {
    val (module, layoutParams) = newModuleWithWindow()
    // WindowManager.LayoutParams' real default: -1 ("follow system", no
    // per-window override) -- set explicitly so the test doesn't silently
    // depend on that default never changing.
    layoutParams.screenBrightness = -1f
    val app = ApplicationProvider.getApplicationContext<Application>()
    Settings.System.putInt(app.contentResolver, Settings.System.SCREEN_BRIGHTNESS, 51) // 51/255 = 0.2
    val promise = mockk<Promise>(relaxed = true)
    val resolved = slot<Any>()
    every { promise.resolve(capture(resolved)) } returns Unit

    module.getBrightnessLevel(promise)

    assertEquals(51.0 / 255.0, resolved.captured as Double, 0.001)
  }

  @Test
  fun `setBrightnessLevel writes the level into the window attributes`() {
    val (module, layoutParams) = newModuleWithWindow()

    module.setBrightnessLevel(0.75)

    assertEquals(0.75f, layoutParams.screenBrightness, 0.001f)
  }
}
