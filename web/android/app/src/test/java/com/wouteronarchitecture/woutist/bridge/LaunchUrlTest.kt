package com.wouteronarchitecture.woutist.bridge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** MainActivity is exported: only in-app paths from our own notifications and widget are followed. */
class LaunchUrlTest {
    @Test fun acceptsAppPaths() {
        assertEquals("/lists/L%3D1?task=T1", LaunchUrl.sanitize("/lists/L%3D1?task=T1"))
        assertEquals("/important", LaunchUrl.sanitize("/important"))
    }

    @Test fun rejectsEverythingElse() {
        for (url in listOf(null, "", "//evil.example/x", "https://evil.example", "javascript:alert(1)", "lists/x", "/lists/x?task=T1&complete=1")) {
            assertNull(url, LaunchUrl.sanitize(url))
        }
    }
}
