package com.wouteronarchitecture.woutist.quickadd

import com.wouteronarchitecture.woutist.data.CustomQuickDate
import com.wouteronarchitecture.woutist.data.DateSettings
import com.wouteronarchitecture.woutist.data.QuickDateEntry
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.time.temporal.TemporalAdjusters
import java.util.Locale

/** Which icon and color a quick date is shown with. */
enum class QuickDateVisual { TODAY, TOMORROW, DAY_AFTER, WEEKEND, NEXT_WEEK, IN_WEEK, DAYS, WEEKS, WEEKDAY }

data class QuickDate(val id: String, val label: String, val short: String, val visual: QuickDateVisual, val date: LocalDate)

/**
 * The quick dates of the quick-add dialog, from the user's [DateSettings]. Same rules as
 * `web/src/models/quickDates.ts`; both are checked against `quickdates-expected.json`.
 */
object QuickDates {
    private val FULL_DAY = listOf("Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday")
    private val SHORT_DAY = listOf("Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat")

    /** 0 = Sunday … 6 = Saturday. */
    private fun jsDay(date: LocalDate) = date.dayOfWeek.value % 7

    fun nextMonday(date: LocalDate): LocalDate = date.with(TemporalAdjusters.next(DayOfWeek.MONDAY))

    /** This Saturday; on a Sunday, the next one. */
    fun thisWeekend(date: LocalDate): LocalDate = when (jsDay(date)) {
        6 -> date
        0 -> date.plusDays(6)
        else -> date.plusDays((6 - jsDay(date)).toLong())
    }

    /** The next given weekday (0 = Sunday) strictly after [date]. */
    fun nextWeekday(date: LocalDate, weekday: Int): LocalDate {
        val delta = ((weekday - jsDay(date) + 7) % 7).let { if (it == 0) 7 else it }
        return date.plusDays(delta.toLong())
    }

    private fun plural(n: Int, unit: String) = "$n $unit${if (n == 1) "" else "s"}"

    private fun option(entry: QuickDateEntry, today: LocalDate): QuickDate? = when (val c = entry.custom) {
        is CustomQuickDate.Days ->
            QuickDate(entry.id, "In ${plural(c.n, "day")}", "In ${plural(c.n, "day")}", QuickDateVisual.DAYS, today.plusDays(c.n.toLong()))
        is CustomQuickDate.Weeks ->
            QuickDate(entry.id, "In ${plural(c.n, "week")}", "In ${c.n} wk", QuickDateVisual.WEEKS, today.plusWeeks(c.n.toLong()))
        is CustomQuickDate.Weekday ->
            QuickDate(entry.id, "Next ${FULL_DAY[c.weekday]}", "Next ${SHORT_DAY[c.weekday]}", QuickDateVisual.WEEKDAY, nextWeekday(today, c.weekday))
        null -> when (entry.id) {
            "today" -> QuickDate(entry.id, "Today", "Today", QuickDateVisual.TODAY, today)
            "tomorrow" -> QuickDate(entry.id, "Tomorrow", "Tomorrow", QuickDateVisual.TOMORROW, today.plusDays(1))
            "dayAfter" -> QuickDate(entry.id, "Day after tomorrow", "In 2 days", QuickDateVisual.DAY_AFTER, today.plusDays(2))
            "weekend" -> QuickDate(entry.id, "This weekend", "Weekend", QuickDateVisual.WEEKEND, thisWeekend(today))
            "nextWeek" -> QuickDate(entry.id, "Next week", "Next week", QuickDateVisual.NEXT_WEEK, nextMonday(today))
            "inWeek" -> QuickDate(entry.id, "In one week", "In 1 week", QuickDateVisual.IN_WEEK, today.plusDays(7))
            else -> null
        }
    }

    /** The enabled quick dates in the user's order, with the date each one picks today. */
    fun options(settings: DateSettings, today: LocalDate): List<QuickDate> =
        settings.quickDates.filter { it.on }.mapNotNull { option(it, today) }

    /** Next to a quick date: the weekday within the coming week ("Fri"), else the date ("Thu 12 Nov"). */
    fun hint(date: LocalDate, today: LocalDate, locale: Locale = Locale.getDefault()): String {
        val days = ChronoUnit.DAYS.between(today, date)
        val pattern = if (days in 0..6) "EEE" else "EEE d MMM"
        return date.format(DateTimeFormatter.ofPattern(pattern, locale))
    }

    /**
     * The reminder time a newly picked date gets: the current one (it moves along with the date), else
     * the first reminder time when Settings asks for that and it isn't already past.
     */
    fun reminderFor(date: LocalDate, current: LocalTime?, settings: DateSettings, now: ZonedDateTime): LocalTime? {
        if (current != null) return current
        val first = settings.reminderTimes.firstOrNull() ?: return null
        if (!settings.preselectFirstTime) return null
        return first.takeIf { date.atTime(it).atZone(now.zone).isAfter(now) }
    }
}
