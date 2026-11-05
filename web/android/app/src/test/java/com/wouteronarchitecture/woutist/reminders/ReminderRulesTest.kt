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

    @Test fun roundTripsThroughJson() {
        val snapshot = Snapshot.parse(resource("snapshot-input.json"))
        assertEquals(snapshot, Snapshot.parse(snapshot.toJson()))
    }
}
