package com.wouteronarchitecture.woutist.reminders

import com.wouteronarchitecture.woutist.data.Snapshot
import com.wouteronarchitecture.woutist.data.resource
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant

class ReminderRulesTest {
    /** Same fixture as `web/src/native/snapshot.test.ts`: the phone arms what Web Push would send. */
    @Test fun matchesSharedFixture() {
        val snapshot = Snapshot.parse(resource("snapshot-input.json"))
        val json = JSONArray(resource("reminders-expected.json"))
        val expected = (0 until json.length()).map { i ->
            val r = json.getJSONObject(i)
            Reminder(r.getString("taskId"), r.getString("listId"), Instant.parse(r.getString("fireAt")))
        }
        assertEquals(expected, ReminderRules.desired(snapshot, Instant.parse("2026-11-05T08:00:00Z")))
    }

    /** A reminder set in quick add rings even if Graph hasn't got the task yet (offline). */
    @Test fun armsRemindersOfTasksStillBeingCreated() {
        val s = Snapshot.parse(resource("snapshot-input.json"))
        val pending = s.copy(tasks = s.tasks + s.tasks.first { it.id == "task-a" }.copy(id = "native_tmp_op1", reminderAt = "2026-11-05T10:00:00.000Z"))
        val desired = ReminderRules.desired(pending, Instant.parse("2026-11-05T08:00:00Z"))
        assertEquals(Instant.parse("2026-11-05T10:00:00Z"), desired.single { it.taskId == "native_tmp_op1" }.fireAt)
    }

    /** Past reminders of open tasks come back oldest first; upcoming ones and tasks without a reminder don't. */
    @Test fun pastDueIsEveryReminderAlreadyDue() {
        val s = Snapshot.parse(resource("snapshot-input.json"))
        val now = Instant.parse("2026-11-05T08:00:00Z")
        val due = ReminderRules.pastDue(s, now)
        assertEquals(due.sortedBy { Instant.parse(it.reminderAt) }.map { it.id }, due.map { it.id })
        assertEquals(true, due.isNotEmpty())
        assertEquals(true, due.all { Instant.parse(it.reminderAt) <= now })
        assertEquals(s.tasks.count { it.reminderAt != null && Instant.parse(it.reminderAt) <= now }, due.size)
        // A reminder still ahead is not past.
        assertEquals(false, due.any { Instant.parse(it.reminderAt) > now })
    }

    @Test fun roundTripsThroughJson() {
        val snapshot = Snapshot.parse(resource("snapshot-input.json"))
        assertEquals(snapshot, Snapshot.parse(snapshot.toJson()))
    }
}
