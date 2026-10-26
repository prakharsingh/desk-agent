package com.deskagentapp

import android.app.Activity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
class SystemBarsTest {
  @Suppress("DEPRECATION")
  private fun flagsAfterHide(): Int {
    val activity = Robolectric.buildActivity(Activity::class.java).create().get()
    SystemBars.hide(activity.window)
    return activity.window.decorView.systemUiVisibility
  }

  @Test
  @Config(sdk = [30])
  fun sdk30_setsLegacyImmersiveFlagsSoModalCopiesThem() {
    assertEquals(SystemBars.LEGACY_IMMERSIVE_FLAGS, flagsAfterHide())
  }

  @Test
  @Config(sdk = [34])
  fun sdk34_doesNotSetLegacyFlags() {
    assertNotEquals(SystemBars.LEGACY_IMMERSIVE_FLAGS, flagsAfterHide())
  }
}
