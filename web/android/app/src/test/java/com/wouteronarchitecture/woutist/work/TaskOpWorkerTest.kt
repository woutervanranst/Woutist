package com.wouteronarchitecture.woutist.work

import com.wouteronarchitecture.woutist.auth.SignInRequired
import com.wouteronarchitecture.woutist.data.GraphHttpException
import com.wouteronarchitecture.woutist.data.PendingOp
import com.wouteronarchitecture.woutist.data.SnapTask
import com.wouteronarchitecture.woutist.data.SnapshotStore
import com.wouteronarchitecture.woutist.data.TaskGraph
import com.wouteronarchitecture.woutist.data.snapshot
import com.wouteronarchitecture.woutist.data.task
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.IOException

class TaskOpWorkerTest {
    @get:Rule val dir = TemporaryFolder()

    private class FakeGraph(val fail: Throwable? = null) : TaskGraph {
        val completed = mutableListOf<String>()
        override suspend fun completeTask(listId: String, taskId: String) {
            fail?.let { throw it }
            completed += taskId
        }
        override suspend fun createTask(listId: String, title: String, important: Boolean, dueDate: String?, reminderAt: String?, notes: String?): SnapTask {
            fail?.let { throw it }
            return SnapTask("server-id", listId, title, important, dueDate, reminderAt, "2026-11-05T08:00:00Z", false)
        }
    }

    private fun storeWithCompleteOp(): SnapshotStore = SnapshotStore(dir.root).apply {
        replaceBase(snapshot(task("A"), task("B")))
        addPending(PendingOp.Complete("op1", "L1", "A"))
    }

    @Test fun dropsOpOnNotFound() = runBlocking {
        val store = storeWithCompleteOp()
        val outcome = TaskOpWorker.execute(store, FakeGraph(GraphHttpException(404, "gone")), "op1") {}
        assertEquals(OpOutcome.Dropped, outcome)
        assertEquals(emptyList<PendingOp>(), store.pending())
    }

    @Test fun keepsOpWhenSignInNeeded() = runBlocking {
        val store = storeWithCompleteOp()
        val outcome = TaskOpWorker.execute(store, FakeGraph(SignInRequired("Sign-in required")), "op1") {}
        assertEquals(OpOutcome.Retry, outcome)
        assertEquals(listOf("op1"), store.pending().map { it.id })
        assertTrue(store.needsSignIn)
        assertEquals(listOf("B"), store.current()!!.tasks.map { it.id })
    }

    @Test fun removesOpAndSignalsOnSuccess() = runBlocking {
        val store = storeWithCompleteOp()
        val graph = FakeGraph()
        var signalled = false
        val outcome = TaskOpWorker.execute(store, graph, "op1") { signalled = true }
        assertEquals(OpOutcome.Success, outcome)
        assertEquals(listOf("A"), graph.completed)
        assertEquals(emptyList<PendingOp>(), store.pending())
        assertTrue(signalled)
        assertEquals(listOf("B"), store.current()!!.tasks.map { it.id })
    }

    @Test fun retriesOnNetworkAndServerErrors() = runBlocking {
        for (failure in listOf(IOException("offline"), GraphHttpException(503, "busy"), GraphHttpException(429, "slow down"))) {
            val store = storeWithCompleteOp()
            assertEquals(OpOutcome.Retry, TaskOpWorker.execute(store, FakeGraph(failure), "op1") {})
            assertEquals(listOf("op1"), store.pending().map { it.id })
            store.clear()
        }
    }

    /** Graph refused it: the completion didn't happen, so the task shows again. */
    @Test fun dropsOpOnOtherClientErrors() = runBlocking {
        val store = storeWithCompleteOp()
        assertEquals(OpOutcome.Dropped, TaskOpWorker.execute(store, FakeGraph(GraphHttpException(400, "bad")), "op1") {})
        assertEquals(emptyList<PendingOp>(), store.pending())
        assertEquals(listOf("A", "B"), store.current()!!.tasks.map { it.id })
    }

    @Test fun treats401LikeSignInRequired() = runBlocking {
        val store = storeWithCompleteOp()
        assertEquals(OpOutcome.Retry, TaskOpWorker.execute(store, FakeGraph(GraphHttpException(401, "expired")), "op1") {})
        assertEquals(listOf("op1"), store.pending().map { it.id })
        assertTrue(store.needsSignIn)
    }

    /** MSAL client/service errors, broker hiccups, bad JSON: retry a while, then give up visibly. */
    @Test fun retriesUnexpectedErrorsThenDrops() = runBlocking {
        val store = storeWithCompleteOp()
        assertEquals(OpOutcome.Retry, TaskOpWorker.execute(store, FakeGraph(IllegalStateException("broker")), "op1", attempt = 0) {})
        assertEquals(listOf("op1"), store.pending().map { it.id })
        assertEquals(OpOutcome.Dropped, TaskOpWorker.execute(store, FakeGraph(IllegalStateException("broker")), "op1", attempt = TaskOpWorker.MAX_ATTEMPTS) {})
        assertEquals(emptyList<PendingOp>(), store.pending())
        assertEquals(listOf("A", "B"), store.current()!!.tasks.map { it.id })
    }

    @Test fun cancellationIsNotSwallowed() {
        val store = storeWithCompleteOp()
        assertThrows(kotlinx.coroutines.CancellationException::class.java) {
            runBlocking { TaskOpWorker.execute(store, FakeGraph(kotlinx.coroutines.CancellationException("stopped")), "op1") {} }
        }
        assertEquals(listOf("op1"), store.pending().map { it.id })
    }

    @Test fun createdTaskReplacesTempTask() = runBlocking {
        val store = SnapshotStore(dir.root).apply {
            replaceBase(snapshot(task("A")))
            addPending(PendingOp.Create("op2", "L1", "Milk", important = false, dueDate = null, notes = null))
        }
        assertEquals(OpOutcome.Success, TaskOpWorker.execute(store, FakeGraph(), "op2") {})
        assertEquals(listOf("A", "server-id"), store.current()!!.tasks.map { it.id })
        assertFalse(store.needsSignIn)
    }

    @Test fun missingOpIsAlreadyDone() = runBlocking {
        val store = storeWithCompleteOp()
        assertEquals(OpOutcome.Success, TaskOpWorker.execute(store, FakeGraph(), "nope") {})
    }
}
