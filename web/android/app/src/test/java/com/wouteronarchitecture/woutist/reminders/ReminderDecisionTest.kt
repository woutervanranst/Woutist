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

    /** The alarm was armed for 09:00, but the reminder was turned off or moved since. */
    @Test fun skipsReminderTurnedOffOrMoved() {
        val s = snapshot(task("A", reminderAt = "2026-11-05T09:00:00.000Z"), task("B"))
        assertTrue(shouldNotify(s, "A", "2026-11-05T09:00:00Z"))
        assertFalse(shouldNotify(s, "A", "2026-11-05T08:00:00Z"))
        assertFalse(shouldNotify(s, "B", "2026-11-05T09:00:00Z"))
        // Snoozes aren't tied to the task's reminder time.
        assertTrue(shouldNotify(s, "B", null))
    }
}
