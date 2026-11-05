package com.wouteronarchitecture.woutist.quickadd

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime

/** Same presets as `web/src/models/presets.ts`. */
class QuickAddPresetsTest {
    private val zone = ZoneId.of("Europe/Brussels")
    private fun at(local: String) = ZonedDateTime.of(java.time.LocalDateTime.parse(local), zone)

    @Test fun duePresets() {
        // 2026-11-05 is a Thursday.
        assertEquals(
            listOf("Today" to "2026-11-05", "Tomorrow" to "2026-11-06", "Next week" to "2026-11-09"),
            QuickAddPresets.due(LocalDate.parse("2026-11-05")).map { it.label to it.date.toString() },
        )
        // From a Monday, next week is the Monday after.
        assertEquals(LocalDate.parse("2026-11-16"), QuickAddPresets.nextMonday(LocalDate.parse("2026-11-09")))
    }

    @Test fun reminderPresets() {
        assertEquals(
            listOf(
                "Later today" to "2026-11-05T15:00:00Z",
                "Tomorrow" to "2026-11-06T08:00:00Z",
                "Next week" to "2026-11-09T08:00:00Z",
            ),
            QuickAddPresets.reminders(at("2026-11-05T13:20:00")).map { it.label to it.at.toInstant().toString() },
        )
    }

    @Test fun noLaterTodayInTheEvening() {
        assertEquals(listOf("Tomorrow", "Next week"), QuickAddPresets.reminders(at("2026-11-05T21:30:00")).map { it.label })
    }

    @Test fun tomorrowAcrossDstIsNineLocal() {
        val tomorrow = QuickAddPresets.reminders(at("2026-03-28T22:00:00")).first { it.label == "Tomorrow" }
        assertEquals("2026-03-29T07:00:00Z", tomorrow.at.toInstant().toString())
    }

    @Test fun labels() {
        val today = LocalDate.parse("2026-11-05")
        assertEquals("Due today", QuickAddPresets.dueLabel(today, today))
        assertEquals("Due tomorrow", QuickAddPresets.dueLabel(today.plusDays(1), today))
        assertEquals("Remind me at 16:00", QuickAddPresets.reminderLabel(at("2026-11-05T16:00:00"), today))
        assertEquals("Remind me tomorrow at 09:00", QuickAddPresets.reminderLabel(at("2026-11-06T09:00:00"), today))
    }

    /** Menu hints don't repeat the preset's name ("Tomorrow · tomorrow at 09:00"). */
    @Test fun menuHints() {
        val today = LocalDate.parse("2026-11-05")
        assertEquals("16:00", QuickAddPresets.menuHint(at("2026-11-05T16:00:00"), today))
        val tomorrow = QuickAddPresets.menuHint(at("2026-11-06T09:00:00"), today)
        assertTrue(tomorrow, tomorrow.endsWith(", 09:00") && !tomorrow.contains("tomorrow"))
    }
}
