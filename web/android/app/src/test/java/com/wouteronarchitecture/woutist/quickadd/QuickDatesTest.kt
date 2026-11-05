package com.wouteronarchitecture.woutist.quickadd

import com.wouteronarchitecture.woutist.data.CustomQuickDate
import com.wouteronarchitecture.woutist.data.DateSettings
import com.wouteronarchitecture.woutist.data.Snapshot
import com.wouteronarchitecture.woutist.data.resource
import com.wouteronarchitecture.woutist.data.snapshot
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.Locale

/** Same rules as `web/src/models/quickDates.ts`, checked against the same fixture. */
class QuickDatesTest {
    private val fixture = Snapshot.parse(resource("snapshot-input.json"))
    private val zone = ZoneId.of("Europe/Brussels")

    @Test fun quickDatesMatchFixture() {
        val expected = JSONObject(resource("quickdates-expected.json"))
        for (today in expected.keys()) {
            val rows = expected.getJSONArray(today)
            val want = (0 until rows.length()).map { i -> rows.getJSONArray(i).let { r -> (0 until r.length()).map { r.getString(it) } } }
            val got = QuickDates.options(fixture.dates, LocalDate.parse(today)).map { listOf(it.id, it.label, it.short, it.date.toString()) }
            assertEquals(today, want, got)
        }
    }

    @Test fun readsSettingsFromTheSnapshot() {
        val d = fixture.dates
        assertEquals(listOf(LocalTime.of(8, 30), LocalTime.of(13, 0)), d.reminderTimes)
        assertEquals(true, d.preselectFirstTime)
        assertEquals(CustomQuickDate.Weekday(3), d.quickDates.first { it.id == "c3" }.custom)
        assertFalse(d.quickDates.first { it.id == "dayAfter" }.on)
    }

    @Test fun olderSnapshotsGetTheDefaults() {
        val old = JSONObject(snapshot().toJson()).apply { remove("dates") }
        assertEquals(DateSettings.DEFAULT, Snapshot.parse(old.toString()).dates)
    }

    @Test fun settingsSurviveTheStore() {
        val s = snapshot().copy(dates = fixture.dates)
        assertEquals(fixture.dates, Snapshot.parse(s.toJson()).dates)
    }

    @Test fun brokenEntriesAreDroppedAndBuiltInsComeBackOff() {
        val d = DateSettings.fromJson(
            JSONObject(
                """{"quickDates":[{"id":"tomorrow","on":true},{"id":"x","on":true,"custom":{"kind":"days","n":0}},{"id":"y","custom":{"kind":"fortnight"}}],
                "reminderTimes":["18:00","noon","08:00"]}""",
            ),
        )
        assertEquals(listOf("tomorrow" to true, "today" to false, "dayAfter" to false, "weekend" to false, "nextWeek" to false, "inWeek" to false), d.quickDates.map { it.id to it.on })
        assertEquals(listOf(LocalTime.of(8, 0), LocalTime.of(18, 0)), d.reminderTimes)
    }

    @Test fun reminderMovesWithTheDateOrIsPreselected() {
        val morning = ZonedDateTime.of(2026, 11, 5, 7, 0, 0, 0, zone)
        val evening = morning.withHour(20)
        val date = LocalDate.parse("2026-11-05")
        val nine = LocalTime.of(9, 0)
        // An existing reminder keeps its hour on the new date.
        assertEquals(LocalTime.of(17, 0), QuickDates.reminderFor(date, LocalTime.of(17, 0), DateSettings.DEFAULT, evening))
        // None yet: only when Settings asks for it, and not in the past.
        assertNull(QuickDates.reminderFor(date, null, DateSettings.DEFAULT, morning))
        val first = DateSettings.DEFAULT.copy(preselectFirstTime = true)
        assertEquals(nine, QuickDates.reminderFor(date, null, first, morning))
        assertNull(QuickDates.reminderFor(date, null, first, evening))
        assertEquals(nine, QuickDates.reminderFor(date.plusDays(1), null, first, evening))
    }

    @Test fun hints() {
        val today = LocalDate.parse("2026-11-05")
        assertEquals("Sat", QuickDates.hint(LocalDate.parse("2026-11-07"), today, Locale.ENGLISH))
        assertEquals("Thu 12 Nov", QuickDates.hint(LocalDate.parse("2026-11-12"), today, Locale.ENGLISH))
    }
}
