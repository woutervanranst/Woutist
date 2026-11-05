package com.wouteronarchitecture.woutist.data

import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalTime
import java.time.format.DateTimeFormatter

/** Ids of the quick dates every user has (they can be turned off, not removed). */
val BUILT_IN_QUICK_DATES = listOf("today", "tomorrow", "dayAfter", "weekend", "nextWeek", "inWeek")

/**
 * The quick dates and reminder times set up in the app's Settings and saved in the Microsoft account.
 * Same rules as `web/src/models/quickDates.ts`; both are checked against `quickdates-expected.json`.
 */
data class DateSettings(
    val quickDates: List<QuickDateEntry>,
    /** Reminder times offered once a date is picked, sorted. */
    val reminderTimes: List<LocalTime>,
    /** Picking a date for a task without a reminder adds one at the first reminder time. */
    val preselectFirstTime: Boolean,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("quickDates", JSONArray(quickDates.map { it.toJson() }))
        .put("reminderTimes", JSONArray(reminderTimes.map { it.format(HHMM) }))
        .put("newReminder", if (preselectFirstTime) "first" else "none")

    companion object {
        private val HHMM = DateTimeFormatter.ofPattern("HH:mm")
        private val TIME_RE = Regex("^([01]\\d|2[0-3]):[0-5]\\d$")

        val DEFAULT = DateSettings(
            quickDates = BUILT_IN_QUICK_DATES.map { QuickDateEntry(it, on = true) },
            reminderTimes = listOf(LocalTime.of(9, 0), LocalTime.of(13, 0), LocalTime.of(18, 0)),
            preselectFirstTime = false,
        )

        /** From the snapshot; anything missing or broken falls back to the defaults (older app versions send none). */
        fun fromJson(o: JSONObject?): DateSettings {
            if (o == null) return DEFAULT
            val quick = o.optJSONArray("quickDates")?.let { arr ->
                val seen = mutableSetOf<String>()
                val parsed = (0 until arr.length()).mapNotNull { i ->
                    val e = arr.optJSONObject(i) ?: return@mapNotNull null
                    val id = e.optString("id").takeIf { it.isNotEmpty() && it !in seen } ?: return@mapNotNull null
                    val on = e.optBoolean("on", true)
                    val entry = if (id in BUILT_IN_QUICK_DATES) {
                        QuickDateEntry(id, on)
                    } else {
                        QuickDateEntry(id, on, CustomQuickDate.fromJson(e.optJSONObject("custom")) ?: return@mapNotNull null)
                    }
                    seen += id
                    entry
                }
                parsed + BUILT_IN_QUICK_DATES.filter { it !in seen }.map { QuickDateEntry(it, on = false) }
            } ?: DEFAULT.quickDates
            val times = o.optJSONArray("reminderTimes")?.let { arr ->
                (0 until arr.length()).map { arr.optString(it) }.filter { TIME_RE.matches(it) }.distinct().sorted()
                    .map { LocalTime.parse(it) }
            } ?: DEFAULT.reminderTimes
            return DateSettings(quick, times, o.optString("newReminder") == "first")
        }
    }
}

data class QuickDateEntry(val id: String, val on: Boolean, val custom: CustomQuickDate? = null) {
    fun toJson(): JSONObject = JSONObject().put("id", id).put("on", on).apply { custom?.let { put("custom", it.toJson()) } }
}

sealed interface CustomQuickDate {
    data class Days(val n: Int) : CustomQuickDate
    data class Weeks(val n: Int) : CustomQuickDate

    /** 0 = Sunday … 6 = Saturday, like JavaScript. */
    data class Weekday(val weekday: Int) : CustomQuickDate

    fun toJson(): JSONObject = when (this) {
        is Days -> JSONObject().put("kind", "days").put("n", n)
        is Weeks -> JSONObject().put("kind", "weeks").put("n", n)
        is Weekday -> JSONObject().put("kind", "weekday").put("weekday", weekday)
    }

    companion object {
        fun fromJson(o: JSONObject?): CustomQuickDate? {
            if (o == null) return null
            return when (o.optString("kind")) {
                "days" -> o.optInt("n").takeIf { it in 1..60 }?.let(::Days)
                "weeks" -> o.optInt("n").takeIf { it in 1..60 }?.let(::Weeks)
                "weekday" -> o.optInt("weekday", -1).takeIf { it in 0..6 }?.let(::Weekday)
                else -> null
            }
        }
    }
}
