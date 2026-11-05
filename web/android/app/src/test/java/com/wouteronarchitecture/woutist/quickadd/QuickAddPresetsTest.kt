package com.wouteronarchitecture.woutist.quickadd

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDate
import java.time.LocalTime
import java.util.Locale

class QuickAddPresetsTest {
    private val today = LocalDate.parse("2026-11-05")

    @Test fun dueLabels() {
        assertEquals("Due today", QuickAddPresets.dueLabel(today, today))
        assertEquals("Due tomorrow", QuickAddPresets.dueLabel(today.plusDays(1), today))
        assertEquals("Due Mon 9 Nov", QuickAddPresets.dueLabel(LocalDate.parse("2026-11-09"), today, Locale.ENGLISH))
    }

    @Test fun remindHints() {
        assertEquals("sets the date to today", QuickAddPresets.remindHint(null, today))
        assertEquals("today", QuickAddPresets.remindHint(today, today))
        assertEquals("on Fri 6 Nov", QuickAddPresets.remindHint(today.plusDays(1), today, Locale.ENGLISH))
    }

    @Test fun times() {
        assertEquals("09:00", QuickAddPresets.timeLabel(LocalTime.of(9, 0), is24Hour = true))
        assertEquals("9:00 AM", QuickAddPresets.timeLabel(LocalTime.of(9, 0), is24Hour = false, Locale.ENGLISH))
    }

    @Test fun nextMondayIsStrictlyAfter() {
        assertEquals(LocalDate.parse("2026-11-09"), QuickDates.nextMonday(today))
        assertEquals(LocalDate.parse("2026-11-16"), QuickDates.nextMonday(LocalDate.parse("2026-11-09")))
    }
}
