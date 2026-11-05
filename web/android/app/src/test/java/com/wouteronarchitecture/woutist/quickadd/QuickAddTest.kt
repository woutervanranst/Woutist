package com.wouteronarchitecture.woutist.quickadd

import com.wouteronarchitecture.woutist.data.SnapList
import com.wouteronarchitecture.woutist.data.snapshot
import com.wouteronarchitecture.woutist.widget.WidgetSource
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDate

class QuickAddTest {
    private val s = snapshot().copy(lists = listOf(SnapList("L1", "Tasks", "defaultList"), SnapList("G", "Groceries", "none")))
    private val today = LocalDate.parse("2026-11-05")

    @Test fun addsToTheWidgetsList() {
        val op = QuickAdd.create(s, WidgetSource.List("G"), "  Milk ", null, today, "op1")!!
        assertEquals("G", op.listId)
        assertEquals("Milk", op.title)
        assertEquals(false, op.important)
        assertNull(op.dueDate)
    }

    @Test fun importantGoesToTasksWithAStar() {
        val op = QuickAdd.create(s, WidgetSource.Smart("important"), "Milk", null, today, "op1")!!
        assertEquals("L1" to true, op.listId to op.important)
    }

    /** "Today" is the phone's local date, passed in by the caller. */
    @Test fun plannedIsDueToday() {
        val op = QuickAdd.create(s, WidgetSource.Smart("planned"), "Milk", null, today, "op1")!!
        assertEquals("L1" to "2026-11-05", op.listId to op.dueDate)
    }

    @Test fun unknownListFallsBackToTasks() {
        assertEquals("L1", QuickAdd.create(s, WidgetSource.List("deleted"), "Milk", null, today, "op1")!!.listId)
    }

    @Test fun keepsSharedNotes() {
        assertEquals("https://example.com/x", QuickAdd.create(s, WidgetSource.List("L1"), "Link", "https://example.com/x", today, "op1")!!.notes)
    }

    @Test fun blankTitleOrNoListAddsNothing() {
        assertNull(QuickAdd.create(s, WidgetSource.List("L1"), "   ", null, today, "op1"))
        assertNull(QuickAdd.create(snapshot().copy(lists = emptyList()), WidgetSource.List("L1"), "Milk", null, today, "op1"))
    }
}
