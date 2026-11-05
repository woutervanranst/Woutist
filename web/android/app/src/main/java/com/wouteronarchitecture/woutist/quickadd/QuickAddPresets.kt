package com.wouteronarchitecture.woutist.quickadd

import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.time.temporal.TemporalAdjusters
import java.util.Locale

/** Due-date and reminder choices of the quick-add dialog; the same as `web/src/models/presets.ts`. */
object QuickAddPresets {
    data class Due(val label: String, val date: LocalDate)
    data class Remind(val label: String, val at: ZonedDateTime)

    private val NINE: LocalTime = LocalTime.of(9, 0)
    private val TIME = DateTimeFormatter.ofPattern("HH:mm")
    private val DAY = DateTimeFormatter.ofPattern("EEE d MMM", Locale.getDefault())

    fun nextMonday(date: LocalDate): LocalDate = date.with(TemporalAdjusters.next(DayOfWeek.MONDAY))

    fun due(today: LocalDate) = listOf(
        Due("Today", today),
        Due("Tomorrow", today.plusDays(1)),
        Due("Next week", nextMonday(today)),
    )

    /** Later today (+3 h, on the hour, only while still today), tomorrow 9:00, next Monday 9:00. */
    fun reminders(now: ZonedDateTime): List<Remind> {
        val today = now.toLocalDate()
        val later = now.plusHours(3).truncatedTo(ChronoUnit.HOURS)
        return listOfNotNull(
            Remind("Later today", later).takeIf { later.toLocalDate() == today },
            Remind("Tomorrow", today.plusDays(1).atTime(NINE).atZone(now.zone)),
            Remind("Next week", nextMonday(today).atTime(NINE).atZone(now.zone)),
        )
    }

    fun dueLabel(date: LocalDate, today: LocalDate): String = when (date) {
        today -> "Due today"
        today.plusDays(1) -> "Due tomorrow"
        else -> "Due ${date.format(DAY)}"
    }

    /** The time next to a reminder preset in the menu: "16:00" today, otherwise "Fri 6 Nov, 09:00". */
    fun menuHint(at: ZonedDateTime, today: LocalDate): String =
        if (at.toLocalDate() == today) at.format(TIME) else "${at.format(DAY)}, ${at.format(TIME)}"

    fun reminderLabel(at: ZonedDateTime, today: LocalDate): String {
        val time = at.format(TIME)
        return when (at.toLocalDate()) {
            today -> "Remind me at $time"
            today.plusDays(1) -> "Remind me tomorrow at $time"
            else -> "Remind me ${at.format(DAY)}, $time"
        }
    }
}
