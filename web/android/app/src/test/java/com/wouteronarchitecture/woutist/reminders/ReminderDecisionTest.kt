package com.wouteronarchitecture.woutist.reminders

import com.wouteronarchitecture.woutist.data.snapshot
import com.wouteronarchitecture.woutist.data.task
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReminderDecisionTest {
    @Test fun skipsTaskMissingFromSnapshot() {
        val s = snapshot(task("A"))
        assertTrue(shouldNotify(s, "A"))
        // Completed, deleted or moved elsewhere since the alarm was armed.
        assertFalse(shouldNotify(s, "gone"))
        assertFalse(shouldNotify(null, "A"))
    }
}
