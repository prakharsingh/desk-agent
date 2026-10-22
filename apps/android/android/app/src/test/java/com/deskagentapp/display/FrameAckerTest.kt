package com.deskagentapp.display

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FrameAckerTest {
    @Test fun `acks rendered and dropped frames cumulatively`() {
        val a = FrameAcker()
        assertEquals(1L, a.finished(1))
        assertEquals(3L, a.finished(3))
        assertNull(a.finished(2))
    }

    @Test fun `never acks a lower seq`() {
        val a = FrameAcker()
        assertEquals(10L, a.finished(10))
        assertNull(a.finished(10))
        assertNull(a.finished(9))
        assertNull(a.finished(1))
        assertEquals(11L, a.finished(11))
    }
}
