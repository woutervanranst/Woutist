package com.wouteronarchitecture.woutist.quickadd

import org.junit.Assert.assertEquals
import org.junit.Test

class SharedTextTest {
    @Test fun multilineTextTitleIsFirstLine() {
        val text = "\n  Groceries for the weekend \nmilk\neggs"
        assertEquals("Groceries for the weekend" to text.trim(), SharedText.parse(null, text))
    }

    @Test fun subjectAndUrl() {
        assertEquals("Woutist test" to "https://example.com/x", SharedText.parse("Woutist test", "https://example.com/x"))
        assertEquals("An article" to "Read this: https://example.com/a", SharedText.parse("An article", "Read this: https://example.com/a"))
    }

    @Test fun urlOnly() {
        assertEquals("https://example.com/x" to "https://example.com/x", SharedText.parse(null, " https://example.com/x "))
    }

    @Test fun singleLine() {
        assertEquals("Call the plumber" to null, SharedText.parse(null, "Call the plumber"))
        assertEquals("Only a subject" to null, SharedText.parse("Only a subject", null))
        assertEquals("" to null, SharedText.parse(null, null))
    }

    @Test fun longTitleTrimmedTo255() {
        val long = "x".repeat(400)
        val (title, notes) = SharedText.parse(null, long)
        assertEquals(255, title.length)
        assertEquals(null, notes)
    }
}
