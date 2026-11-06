package com.wouteronarchitecture.woutist.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

class SnapshotStoreTest {
    @get:Rule val dir = TemporaryFolder()
    private var changes = 0
    // 23:30 UTC on the 4th: already the 5th in the snapshot's zone (Brussels).
    private val clock = Clock.fixed(Instant.parse("2026-11-04T23:30:00Z"), ZoneOffset.UTC)
    private fun store() = SnapshotStore(dir.root, clock) { changes++ }
    private fun ids(s: SnapshotStore) = s.current()!!.tasks.map { it.id }

    @Test fun pendingCompleteHidesTask() {
        val s = store()
        s.replaceBase(snapshot(task("A"), task("B")))
        s.addPending(PendingOp.Complete("op1", "L1", "A"))
        assertEquals(listOf("B"), ids(s))
    }

    @Test fun pendingCompleteListsTaskAsCompletedToday() {
        val s = store()
        s.replaceBase(snapshot(task("A"), task("B")).copy(completedToday = listOf(task("C").copy(completedDate = "2026-11-05"))))
        s.addPending(PendingOp.Complete("op1", "L1", "A"))
        val done = s.current()!!.completedToday
        assertEquals(listOf("C" to "2026-11-05", "A" to "2026-11-05"), done.map { it.id to it.completedDate })
        // Still listed once Graph confirmed it, until a fresh base says otherwise.
        s.removePending("op1")
        assertEquals(listOf("C", "A"), s.current()!!.completedToday.map { it.id })
        assertEquals(listOf("B"), ids(s))
    }

    @Test fun completedTodaySurvivesProcessRestart() {
        store().replaceBase(snapshot(task("A")).copy(completedToday = listOf(task("C").copy(completedDate = "2026-11-05"))))
        assertEquals(listOf("C" to "2026-11-05"), store().current()!!.completedToday.map { it.id to it.completedDate })
    }

    @Test fun pendingCreateAppendsTempTask() {
        val s = store()
        s.replaceBase(snapshot(task("A")))
        s.addPending(PendingOp.Create("op2", "L1", "Milk", important = true, dueDate = "2026-11-06", notes = null))
        val created = s.current()!!.tasks.last()
        assertEquals("native_tmp_op2", created.id)
        assertEquals(SnapTask("native_tmp_op2", "L1", "Milk", true, "2026-11-06", null, created.createdDateTime, false), created)
    }

    @Test fun completedOverlayClearsWhenOpSucceeds() {
        val s = store()
        s.replaceBase(snapshot(task("R", dueDate = "2026-11-05", recurring = true)))
        s.addPending(PendingOp.Complete("op1", "L1", "R"))
        s.removePending("op1")
        // Done on the server: hidden until a fresh base says otherwise.
        assertEquals(emptyList<String>(), ids(s))
        // Graph keeps a recurring task open under the same id with its next due date.
        s.replaceBase(snapshot(task("R", dueDate = "2026-11-06", recurring = true)))
        assertEquals("2026-11-06", s.current()!!.tasks.single { it.id == "R" }.dueDate)
    }

    @Test fun dropPendingKeepsTheBase() {
        val s = store()
        s.replaceBase(snapshot(task("A"), task("B")))
        s.addPending(PendingOp.Complete("op1", "L1", "A"))
        s.dropPending("op1")
        assertEquals(listOf("A", "B"), ids(s))
        assertEquals(emptyList<PendingOp>(), s.pending())
    }

    @Test fun replaceBaseKeepsPendingOverlay() {
        val s = store()
        s.replaceBase(snapshot(task("A")))
        s.addPending(PendingOp.Complete("op1", "L1", "A"))
        s.replaceBase(snapshot(task("A"), task("C")))
        assertEquals(listOf("C"), ids(s))
        assertEquals(listOf("op1"), s.pending().map { it.id })
    }

    @Test fun replaceBaseWithOtherAccountDropsPending() {
        val s = store()
        s.replaceBase(snapshot(task("A")))
        s.addPending(PendingOp.Complete("op1", "L1", "A"))
        s.addPending(PendingOp.Create("op2", "L1", "Milk", false, null, null))
        s.replaceBase(snapshot(task("A"), accountKey = "someone.else"))
        assertEquals(emptyList<PendingOp>(), s.pending())
        assertEquals(listOf("A"), ids(s))
    }

    @Test fun survivesProcessRestart() {
        store().apply {
            replaceBase(snapshot(task("A"), task("B")))
            addPending(PendingOp.Complete("op1", "L1", "A"))
            needsSignIn = true
        }
        val reopened = store()
        assertEquals(listOf("B"), ids(reopened))
        assertTrue(reopened.needsSignIn)
    }

    @Test fun replaceBaseClearsNeedsSignInAndNotifies() {
        val s = store()
        s.needsSignIn = true
        val before = changes
        s.replaceBase(snapshot(task("A")))
        assertFalse(s.needsSignIn)
        assertTrue(changes > before)
    }

    @Test fun clearForgetsEverything() {
        val s = store()
        s.replaceBase(snapshot(task("A")))
        s.addPending(PendingOp.Complete("op1", "L1", "A"))
        s.clear()
        assertEquals(null, s.current())
        assertEquals(emptyList<PendingOp>(), s.pending())
        assertEquals(null, store().current())
    }

    @Test fun notificationUrlSurvivesRestartWithoutNotifying() {
        val first = store()
        first.notificationUrl = "https://api.test/api/graph-notify?u=user"
        assertEquals(0, changes)
        assertEquals("https://api.test/api/graph-notify?u=user", SnapshotStore(dir.root, clock).notificationUrl)
    }

    @Test fun clearForgetsNotificationUrl() {
        val s = store()
        s.notificationUrl = "https://api.test/n"
        s.clear()
        assertEquals(null, SnapshotStore(dir.root, clock).notificationUrl)
    }
}
