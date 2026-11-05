package com.wouteronarchitecture.woutist.work

import com.wouteronarchitecture.woutist.auth.SignInRequired
import com.wouteronarchitecture.woutist.data.DateSettings
import com.wouteronarchitecture.woutist.data.PendingOp
import com.wouteronarchitecture.woutist.data.SnapshotStore
import com.wouteronarchitecture.woutist.data.SortPref
import com.wouteronarchitecture.woutist.data.snapshot
import com.wouteronarchitecture.woutist.data.task
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.IOException

class RefreshWorkerTest {
    @get:Rule val dir = TemporaryFolder()
    private val sort = mapOf("list:L1" to SortPref("title", "asc"))
    private val dates = DateSettings.DEFAULT.copy(preselectFirstTime = true)
    private fun store() = SnapshotStore(dir.root).apply { replaceBase(snapshot(task("A")).copy(sort = sort, dates = dates)) }

    @Test fun replacesBaseKeepingSortAndPendingOverlay() = runBlocking {
        val store = store()
        store.addPending(PendingOp.Complete("op1", "L1", "B"))
        var askedSort: Map<String, SortPref>? = null
        val outcome = RefreshWorker.execute(store, "oid.tid") { key, s ->
            askedSort = s
            snapshot(task("A"), task("B"), task("C"), accountKey = key)
        }
        assertEquals(RefreshOutcome.Refreshed, outcome)
        assertEquals(sort, askedSort)
        assertEquals(sort, store.current()!!.sort)
        // Quick dates come from the app too; Graph's tasks don't have them.
        assertEquals(dates, store.current()!!.dates)
        assertEquals(listOf("A", "C"), store.current()!!.tasks.map { it.id })
    }

    @Test fun signInRequiredSetsFlag() = runBlocking {
        val store = store()
        assertEquals(RefreshOutcome.NeedsSignIn, RefreshWorker.execute(store, "oid.tid") { _, _ -> throw SignInRequired("expired") })
        assertTrue(store.needsSignIn)
        assertEquals(listOf("A"), store.current()!!.tasks.map { it.id })
    }

    @Test fun retriesWhenOffline() = runBlocking {
        assertEquals(RefreshOutcome.Retry, RefreshWorker.execute(store(), "oid.tid") { _, _ -> throw IOException("offline") })
    }

    @Test fun skipsWithoutMatchingAccount() = runBlocking {
        var fetched = false
        assertEquals(RefreshOutcome.Skipped, RefreshWorker.execute(store(), "someone.else") { _, _ -> fetched = true; snapshot() })
        assertEquals(RefreshOutcome.Skipped, RefreshWorker.execute(SnapshotStore(dir.newFolder()), "oid.tid") { _, _ -> fetched = true; snapshot() })
        assertEquals(false, fetched)
    }

    @Test fun doesNotOverwriteASnapshotTheAppPushedMeanwhile() = runBlocking {
        val store = store()
        val outcome = RefreshWorker.execute(store, "oid.tid") { key, _ ->
            // The app pushes a newer snapshot while Graph is being read.
            store.replaceBase(snapshot(task("FromApp"), accountKey = key).copy(generatedAt = "2026-11-05T08:05:00Z"))
            snapshot(task("FromGraph"), accountKey = key)
        }
        assertEquals(RefreshOutcome.Skipped, outcome)
        assertEquals(listOf("FromApp"), store.current()!!.tasks.map { it.id })
    }

    /** Changes made in the app offline are only in its outbox; Graph doesn't have them yet. */
    @Test fun keepsAppSnapshotWithUnsentChanges() = runBlocking {
        val store = SnapshotStore(dir.root).apply { replaceBase(snapshot(task("A", reminderAt = "2026-11-05T09:00:00Z")).copy(outboxPending = true)) }
        assertEquals(RefreshOutcome.Skipped, RefreshWorker.execute(store, "oid.tid") { _, _ -> snapshot(task("A")) })
        assertEquals("2026-11-05T09:00:00Z", store.current()!!.tasks.single().reminderAt)
    }
}
