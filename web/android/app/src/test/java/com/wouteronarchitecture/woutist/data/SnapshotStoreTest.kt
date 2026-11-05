package com.wouteronarchitecture.woutist.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class SnapshotStoreTest {
    @get:Rule val dir = TemporaryFolder()
    private var changes = 0
    private fun store() = SnapshotStore(dir.root) { changes++ }
    private fun ids(s: SnapshotStore) = s.current()!!.tasks.map { it.id }

    @Test fun pendingCompleteHidesTask() {
        val s = store()
        s.replaceBase(snapshot(task("A"), task("B")))
        s.addPending(PendingOp.Complete("op1", "L1", "A"))
        assertEquals(listOf("B"), ids(s))
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
}
