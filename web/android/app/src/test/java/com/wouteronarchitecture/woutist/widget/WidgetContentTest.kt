package com.wouteronarchitecture.woutist.widget

import com.wouteronarchitecture.woutist.data.SnapList
import com.wouteronarchitecture.woutist.data.Snapshot
import com.wouteronarchitecture.woutist.data.resource
import com.wouteronarchitecture.woutist.data.snapshot
import com.wouteronarchitecture.woutist.data.task
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

class WidgetContentTest {
    private val fixture = Snapshot.parse(resource("snapshot-input.json"))

    /** Same fixture as `widgetTasksMatchFixture` in `web/src/native/snapshot.test.ts`. */
    @Test fun matchesSharedFixture() {
        val expected = JSONObject(resource("widget-expected.json"))
        for (key in expected.keys()) {
            val ids = expected.getJSONArray(key).let { a -> (0 until a.length()).map { a.getString(it) } }
            assertEquals(key, ids, WidgetContent.tasks(fixture, WidgetSource.fromKey(key)).map { it.id })
        }
    }

    @Test fun longTitlesAndEmojiNamesSurvive() {
        val long = "Call the plumber about the kitchen sink ".repeat(8).trim()
        val s = snapshot(task("T1", listId = "G", title = long)).copy(lists = listOf(SnapList("G", "🛒 Groceries", "none")))
        assertEquals(long, WidgetContent.tasks(s, WidgetSource.List("G")).single().title)
        assertEquals("🛒 Groceries", WidgetContent.title(s, WidgetSource.List("G")))
    }

    @Test fun titlesOfSmartLists() {
        assertEquals("Important", WidgetContent.title(fixture, WidgetSource.Smart("important")))
        assertEquals("Planned", WidgetContent.title(fixture, WidgetSource.Smart("planned")))
    }

    /** A list deleted elsewhere (or unknown before the first snapshot) shows Tasks. */
    @Test fun unknownListFallsBackToTasks() {
        assertEquals("Tasks", WidgetContent.title(fixture, WidgetSource.List("deleted")))
        assertEquals(WidgetContent.tasks(fixture, WidgetSource.List("L1")), WidgetContent.tasks(fixture, WidgetSource.List("deleted")))
    }

    @Test fun dueLabels() {
        val today = LocalDate.parse("2026-11-05")
        assertEquals("Today", WidgetContent.dueLabel(task("a", dueDate = "2026-11-05"), today))
        assertEquals("Tomorrow", WidgetContent.dueLabel(task("a", dueDate = "2026-11-06"), today))
        assertEquals("Yesterday", WidgetContent.dueLabel(task("a", dueDate = "2026-11-04"), today))
        assertNull(WidgetContent.dueLabel(task("a"), today))
        assertTrue(WidgetContent.overdue(task("a", dueDate = "2026-11-04"), today))
        assertFalse(WidgetContent.overdue(task("a", dueDate = "2026-11-05"), today))
    }

    @Test fun sourceRoundTripsThroughJson() {
        for (source in listOf(WidgetSource.List("L1"), WidgetSource.Smart("important"), WidgetSource.Smart("planned"))) {
            assertEquals(source, WidgetSource.parse(source.toJson()))
        }
        assertEquals(WidgetSource.List(""), WidgetSource.parse("not json"))
    }

    @Test fun appPathOpensTheView() {
        assertEquals("/lists/L%3D1", WidgetContent.path(WidgetSource.List("L=1")))
        assertEquals("/important", WidgetContent.path(WidgetSource.Smart("important")))
    }
}
