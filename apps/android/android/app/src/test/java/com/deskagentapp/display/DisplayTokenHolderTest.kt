package com.deskagentapp.display

import android.content.Intent
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class DisplayTokenHolderTest {
    @After fun reset() { DisplayTokenHolder.clear(); DisplayTokenHolder.setListener(null) }

    private fun intent(token: String? = null, sid: String? = null) = Intent().apply {
        token?.let { putExtra(DisplayTokenHolder.EXTRA_TOKEN, it) }
        sid?.let { putExtra(DisplayTokenHolder.EXTRA_SESSION_ID, it) }
    }

    @Test fun `offer then take returns the token exactly once`() {
        DisplayTokenHolder.offer("s1", "t1")
        assertEquals("t1", DisplayTokenHolder.take("s1"))
        assertNull(DisplayTokenHolder.take("s1"))
    }

    @Test fun `take for another session returns null and keeps the token`() {
        DisplayTokenHolder.offer("s1", "t1")
        assertNull(DisplayTokenHolder.take("s2"))
        assertEquals("t1", DisplayTokenHolder.take("s1"))
    }

    @Test fun `an offer for another session does not evict the held one`() {
        DisplayTokenHolder.offer("s1", "t1")
        DisplayTokenHolder.offer("s2", "t2")
        assertEquals("t2", DisplayTokenHolder.take("s2"))
        assertEquals("t1", DisplayTokenHolder.take("s1"))
    }

    @Test fun `three unrelated offers cannot evict the real token, a fifth distinct offer evicts the oldest`() {
        DisplayTokenHolder.offer("real", "t-real")
        DisplayTokenHolder.offer("fake1", "x1")
        DisplayTokenHolder.offer("fake2", "x2")
        DisplayTokenHolder.offer("fake3", "x3")
        assertEquals(4, DisplayTokenHolder.heldCountForTest())
        assertEquals("t-real", DisplayTokenHolder.take("real"))
        // take(id) removes only that id
        assertEquals(3, DisplayTokenHolder.heldCountForTest())

        DisplayTokenHolder.clear()
        DisplayTokenHolder.offer("a", "1")
        DisplayTokenHolder.offer("b", "2")
        DisplayTokenHolder.offer("c", "3")
        DisplayTokenHolder.offer("d", "4")
        DisplayTokenHolder.offer("e", "5")
        assertEquals(DisplayTokenHolder.MAX_HELD, DisplayTokenHolder.heldCountForTest())
        assertNull(DisplayTokenHolder.take("a"))
        assertEquals("2", DisplayTokenHolder.take("b"))
        assertEquals("5", DisplayTokenHolder.take("e"))
    }

    @Test fun `a re-offer for a held session refreshes it as the newest`() {
        DisplayTokenHolder.offer("a", "1")
        DisplayTokenHolder.offer("b", "2")
        DisplayTokenHolder.offer("c", "3")
        DisplayTokenHolder.offer("d", "4")
        DisplayTokenHolder.offer("a", "1b")
        DisplayTokenHolder.offer("e", "5")
        assertNull(DisplayTokenHolder.take("b"))
        assertEquals("1b", DisplayTokenHolder.take("a"))
    }

    @Test fun `the holder keeps no plain-text copy of an accepted token after take`() {
        DisplayTokenHolder.offer("s1", "secret-token-value")
        assertEquals("secret-token-value", DisplayTokenHolder.take("s1"))
        // The repeat guard survives take(); it must hold a digest, not the token.
        val values = DisplayTokenHolder::class.java.declaredFields.mapNotNull { f ->
            f.isAccessible = true
            runCatching { f.get(DisplayTokenHolder) }.getOrNull()
        }
        for (v in values) {
            assertFalse("field holds the token: $v", v == "secret-token-value")
            if (v is Map<*, *>) assertFalse(v.values.contains("secret-token-value"))
        }
    }

    @Test fun `readFromIntent consumes both extras`() {
        val i = intent("t1", "s1")
        assertTrue(DisplayTokenHolder.readFromIntent(i))
        assertFalse(i.hasExtra(DisplayTokenHolder.EXTRA_TOKEN))
        assertFalse(i.hasExtra(DisplayTokenHolder.EXTRA_SESSION_ID))
        assertEquals("t1", DisplayTokenHolder.take("s1"))
    }

    @Test fun `readFromIntent ignores an intent with only one extra`() {
        assertFalse(DisplayTokenHolder.readFromIntent(intent(token = "t1")))
        assertFalse(DisplayTokenHolder.readFromIntent(intent(sid = "s1")))
        assertFalse(DisplayTokenHolder.readFromIntent(null))
        assertNull(DisplayTokenHolder.take("s1"))
    }

    @Test fun `an extras-less intent does not clear or replace a held token`() {
        DisplayTokenHolder.offer("s1", "t1")
        assertFalse(DisplayTokenHolder.readFromIntent(Intent()))
        assertEquals("t1", DisplayTokenHolder.take("s1"))
    }

    @Test fun `listener fires on offer with the sessionId`() {
        val seen = mutableListOf<String>()
        DisplayTokenHolder.setListener { seen += it }
        DisplayTokenHolder.offer("s1", "t1")
        assertEquals(listOf("s1"), seen)
    }

    @Test fun `a repeat of the same token and session is a no-op even after take`() {
        val seen = mutableListOf<String>()
        DisplayTokenHolder.setListener { seen += it }
        assertTrue(DisplayTokenHolder.readFromIntent(intent("t1", "s1")))
        assertEquals("t1", DisplayTokenHolder.take("s1"))
        val repeat = intent("t1", "s1")
        assertTrue(DisplayTokenHolder.readFromIntent(repeat))
        assertFalse(repeat.hasExtra(DisplayTokenHolder.EXTRA_TOKEN))
        assertEquals(listOf("s1"), seen)
        assertNull(DisplayTokenHolder.take("s1"))
    }

    @Test fun `a new token for the same session is accepted`() {
        DisplayTokenHolder.offer("s1", "t1")
        DisplayTokenHolder.offer("s1", "t2")
        assertEquals("t2", DisplayTokenHolder.take("s1"))
    }
}
