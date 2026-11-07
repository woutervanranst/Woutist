package com.wouteronarchitecture.woutist.reminders

import com.wouteronarchitecture.woutist.data.SnapTask
import com.wouteronarchitecture.woutist.data.Snapshot
import java.time.Duration
import java.time.Instant

/** An alarm to arm. [key] is the task id, or `snooze:<taskId>` for a snoozed reminder. */
data class Reminder(val taskId: String, val listId: String, val fireAt: Instant, val key: String = taskId)

/**
 * Same rules as `web/src/services/push/reminders.ts` (`upcomingReminders`). Tasks the phone is still
 * creating (`native_tmp_`, e.g. quick add while offline) do get their reminder; the web app's own
 * temporary ids (`tmp_`) never reach the phone.
 */
object ReminderRules {
    private val GRACE: Duration = Duration.ofSeconds(60)
    private val HORIZON: Duration = Duration.ofDays(90)
    private const val MAX = 1000

    fun desired(s: Snapshot, now: Instant): List<Reminder> {
        val from = now.minus(GRACE)
        val until = now.plus(HORIZON)
        return s.tasks.asSequence()
            .filter { it.reminderAt != null && !it.id.startsWith("tmp_") }
            .map { Reminder(it.id, it.listId, Instant.parse(it.reminderAt)) }
            .filter { it.fireAt > from && it.fireAt <= until }
            .sortedWith(compareBy<Reminder> { it.fireAt }.thenBy { it.taskId })
            .take(MAX)
            .toList()
    }

    /**
     * The open tasks whose reminder has already come due, oldest first: what "show past reminders again"
     * notifies. The snapshot holds open tasks only, and `reminderAt` only while the reminder is on.
     * (`pastReminders` in `web/src/services/push/reminders.ts` is the web twin.)
     */
    fun pastDue(s: Snapshot, now: Instant): List<SnapTask> =
        s.tasks.asSequence()
            .filter { it.reminderAt != null && !it.id.startsWith("tmp_") }
            .filter { Instant.parse(it.reminderAt) <= now }
            .sortedWith(compareBy<SnapTask> { Instant.parse(it.reminderAt) }.thenBy { it.id })
            .toList()
}
