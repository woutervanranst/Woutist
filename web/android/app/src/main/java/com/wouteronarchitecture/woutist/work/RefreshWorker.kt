package com.wouteronarchitecture.woutist.work

import android.content.Context
import android.util.Log
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.wouteronarchitecture.woutist.auth.AuthManager
import com.wouteronarchitecture.woutist.auth.GRAPH_SCOPES
import com.wouteronarchitecture.woutist.auth.SignInRequired
import com.wouteronarchitecture.woutist.data.GraphApi
import com.wouteronarchitecture.woutist.data.GraphHttpException
import com.wouteronarchitecture.woutist.data.Snapshot
import com.wouteronarchitecture.woutist.data.SnapshotStore
import com.wouteronarchitecture.woutist.data.SortPref
import java.io.IOException
import java.time.ZoneId
import java.util.concurrent.TimeUnit

enum class RefreshOutcome { Refreshed, Skipped, NeedsSignIn, Retry }

/**
 * Reads the account from Graph while the app is closed, so reminders set elsewhere (the official
 * app, the web) get armed and the widget stays current.
 */
class RefreshWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        AuthManager.init(applicationContext)
        val store = SnapshotStore.get(applicationContext)
        val accountKey = runCatching { AuthManager.account()?.key }.getOrNull()
        val graph = GraphApi({ AuthManager.tokenSilent(GRAPH_SCOPES) })
        val zone = ZoneId.systemDefault()
        val outcome = execute(store, accountKey) { key, sort ->
            graph.fetchSnapshot(key, zone, sort, fallbackCompleted = store.current()?.completedToday.orEmpty())
        }
        Log.i("Woutist", "Background refresh: $outcome")
        return if (outcome == RefreshOutcome.Retry) Result.retry() else Result.success()
    }

    companion object {
        private const val PERIODIC = "refresh"
        private const val NOW = "refresh-now"

        /**
         * Replace the stored snapshot with Graph's, keeping the app's preferences (sort, quick dates). Skipped without
         * a snapshot of the signed-in account, while the app has unsent changes, or when the app pushed
         * a newer snapshot during the fetch.
         */
        suspend fun execute(
            store: SnapshotStore,
            accountKey: String?,
            fetch: suspend (accountKey: String, sort: Map<String, SortPref>) -> Snapshot,
        ): RefreshOutcome {
            val base = store.current() ?: return RefreshOutcome.Skipped
            if (accountKey == null || base.accountKey != accountKey || base.outboxPending) return RefreshOutcome.Skipped
            return try {
                // Sort preferences and quick dates come from the app, not from the tasks in Graph.
                val fresh = fetch(accountKey, base.sort).copy(sort = base.sort, dates = base.dates)
                if (store.replaceBaseIfUnchanged(base.generatedAt, fresh)) RefreshOutcome.Refreshed else RefreshOutcome.Skipped
            } catch (e: SignInRequired) {
                store.needsSignIn = true
                RefreshOutcome.NeedsSignIn
            } catch (e: GraphHttpException) {
                if (e.status == 429 || e.status >= 500) RefreshOutcome.Retry else RefreshOutcome.Skipped
            } catch (e: IOException) {
                RefreshOutcome.Retry
            }
        }

        private val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        /** Every 30 minutes while signed in (Android may stretch this when the phone is idle). */
        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<RefreshWorker>(30, TimeUnit.MINUTES).setConstraints(online).build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, request)
        }

        /** One refresh as soon as the phone is online, e.g. after a change made from a notification. */
        fun refreshSoon(context: Context) {
            val request = OneTimeWorkRequestBuilder<RefreshWorker>().setConstraints(online).build()
            WorkManager.getInstance(context).enqueueUniqueWork(NOW, ExistingWorkPolicy.REPLACE, request)
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).run {
                cancelUniqueWork(PERIODIC)
                cancelUniqueWork(NOW)
            }
        }
    }
}
