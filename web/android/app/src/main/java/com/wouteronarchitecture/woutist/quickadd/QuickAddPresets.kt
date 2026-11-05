package com.wouteronarchitecture.woutist.quickadd

import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Labels of the quick-add dialog's date and reminder controls (the choices come from [QuickDates]). */
object QuickAddPresets {
    private fun day(locale: Locale) = DateTimeFormatter.ofPattern("EEE d MMM", locale)

    fun dueLabel(date: LocalDate, today: LocalDate, locale: Locale = Locale.getDefault()): String = when (date) {
        today -> "Due today"
        today.plusDays(1) -> "Due tomorrow"
        else -> "Due ${date.format(day(locale))}"
    }

    /** Where a reminder hour goes: "on Fri 6 Nov", or, without a date yet, today. */
    fun remindHint(due: LocalDate?, today: LocalDate, locale: Locale = Locale.getDefault()): String = when (due) {
        null -> "sets the date to today"
        today -> "today"
        else -> "on ${due.format(day(locale))}"
    }

    fun timeLabel(time: LocalTime, is24Hour: Boolean, locale: Locale = Locale.getDefault()): String =
        time.format(DateTimeFormatter.ofPattern(if (is24Hour) "HH:mm" else "h:mm a", locale))
}
