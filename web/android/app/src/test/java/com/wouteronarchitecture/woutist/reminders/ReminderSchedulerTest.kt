package com.wouteronarchitecture.woutist.reminders

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant

class ReminderSchedulerTest {
    private val t1 = Instant.parse("2026-11-05T09:00:00Z")
    private val t2 = Instant.parse("2026-11-05T10:00:00Z")
    private val t3 = Instant.parse("2026-11-05T11:00:00Z")

    @Test fun diffIsIdempotent() {
        val desired = listOf(Reminder("a", "L1", t1), Reminder("b", "L1", t2))
        val (cancel, set) = ReminderScheduler.diff(emptyMap(), desired)
        assertEquals(emptyList<String>(), cancel)
        assertEquals(desired, set)
        val armed = set.associate { it.key to it.fireAt }
        assertEquals(Pair(emptyList<String>(), emptyList<Reminder>()), ReminderScheduler.diff(armed, desired))
    }

    @Test fun diffCancelsRemovedAndReArmsChanged() {
        val armed = mapOf("a" to t1, "b" to t2, "d" to t3)
        val desired = listOf(Reminder("a", "L1", t1), Reminder("b", "L1", t3), Reminder("c", "L2", t3))
        val (cancel, set) = ReminderScheduler.diff(armed, desired)
        assertEquals(listOf("d"), cancel)
        assertEquals(listOf(Reminder("b", "L1", t3), Reminder("c", "L2", t3)), set)
    }

    /** After a reboot, update or force-stop the armed record can't be trusted: re-arm everything still ahead. */
    @Test fun forcedPlanReArmsFutureRemindersOnly() {
        val now = Instant.parse("2026-11-05T09:00:30Z")
        val armed = mapOf("a" to t1, "b" to t2, "x" to t3)
        val desired = listOf(Reminder("a", "L1", t1), Reminder("b", "L1", t2))
        val (cancel, set) = ReminderScheduler.plan(armed, desired, now, force = true)
        assertEquals(listOf("x"), cancel)
        // "a" fired 30 s ago; arming it again would notify twice.
        assertEquals(listOf(Reminder("b", "L1", t2)), set)
    }

    /** Alarms don't survive a reboot or force-stop: reminders that came due meanwhile are shown late. */
    @Test fun missedRemindersAfterARebootAreFound() {
        val now = Instant.parse("2026-11-05T09:00:00Z")
        val armed = mapOf(
            "fired" to Instant.parse("2026-11-05T08:00:00Z"),
            "missed" to Instant.parse("2026-11-05T08:30:00Z"),
            "moved" to Instant.parse("2026-11-05T08:40:00Z"),
            "ahead" to Instant.parse("2026-11-05T12:00:00Z"),
            "old" to Instant.parse("2026-11-04T20:00:00Z"),
            "snooze:sn" to Instant.parse("2026-11-05T08:50:00Z"),
        )
        val fired = mapOf("fired" to Instant.parse("2026-11-05T08:00:00Z"))
        val current = com.wouteronarchitecture.woutist.data.snapshot(
            com.wouteronarchitecture.woutist.data.task("fired", reminderAt = "2026-11-05T08:00:00Z"),
            com.wouteronarchitecture.woutist.data.task("missed", reminderAt = "2026-11-05T08:30:00Z"),
            com.wouteronarchitecture.woutist.data.task("moved", reminderAt = "2026-11-05T10:00:00Z"),
            com.wouteronarchitecture.woutist.data.task("ahead", reminderAt = "2026-11-05T12:00:00Z"),
            com.wouteronarchitecture.woutist.data.task("old", reminderAt = "2026-11-04T20:00:00Z"),
            com.wouteronarchitecture.woutist.data.task("sn"),
        )
        assertEquals(listOf("missed", "sn"), ReminderScheduler.missed(armed, fired, current, now).map { it.taskId })
    }

    /** Android allows an app 500 alarms; arm the nearest ones and re-plan as the snapshot changes. */
    @Test fun planArmsAtMostTheNearestAlarms() {
        val desired = (0 until 450).map { Reminder("t$it", "L1", t1.plusSeconds(60L * it)) }
        val (_, set) = ReminderScheduler.plan(emptyMap(), desired, t1.minusSeconds(60), force = false)
        assertEquals(ReminderScheduler.MAX_ALARMS, set.size)
        assertEquals(desired.take(ReminderScheduler.MAX_ALARMS), set)
    }

    @Test fun snoozeHasItsOwnKey() {
        val snooze = Reminder("a", "L1", t2, key = ReminderScheduler.snoozeKey("a"))
        val (cancel, set) = ReminderScheduler.diff(mapOf("a" to t1), listOf(Reminder("a", "L1", t1), snooze))
        assertEquals(emptyList<String>(), cancel)
        assertEquals(listOf(snooze), set)
    }
}
