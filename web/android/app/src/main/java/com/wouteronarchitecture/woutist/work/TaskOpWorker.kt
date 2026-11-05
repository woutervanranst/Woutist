package com.wouteronarchitecture.woutist.work

import android.content.Context
import android.util.Log
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.wouteronarchitecture.woutist.auth.AuthManager
import com.wouteronarchitecture.woutist.auth.GRAPH_SCOPES
import com.wouteronarchitecture.woutist.auth.SignInRequired
import com.wouteronarchitecture.woutist.bridge.NativeEvents
import com.wouteronarchitecture.woutist.data.GraphApi
import com.wouteronarchitecture.woutist.data.GraphHttpException
import com.wouteronarchitecture.woutist.data.PendingOp
import com.wouteronarchitecture.woutist.data.SnapshotStore
import com.wouteronarchitecture.woutist.data.TaskGraph
import java.io.IOException
import java.util.concurrent.TimeUnit

enum class OpOutcome { Success, Dropped, Retry }

/** Sends one pending operation (complete or create) to Graph, retrying with backoff while offline. */
class TaskOpWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val opId = inputData.getString(KEY_OP) ?: return Result.success()
        AuthManager.init(applicationContext)
        val store = SnapshotStore.get(applicationContext)
        val graph = GraphApi({ AuthManager.tokenSilent(GRAPH_SCOPES) })
        val outcome = execute(store, graph, opId) { NativeEvents.changed() }
        Log.i("Woutist", "Pending operation $opId: $outcome (attempt ${runAttemptCount + 1})")
        // A recurring task comes back with its next date; Graph has the details.
        if (outcome == OpOutcome.Success) RefreshWorker.refreshSoon(applicationContext)
        return when (outcome) {
            OpOutcome.Success, OpOutcome.Dropped -> Result.success()
            OpOutcome.Retry -> Result.retry()
        }
    }

    companion object {
        private const val KEY_OP = "opId"
        private const val TAG = "woutist-op"

        /** Run [opId] against [graph]; [signal] tells a running app to sync. */
        suspend fun execute(store: SnapshotStore, graph: TaskGraph, opId: String, signal: () -> Unit): OpOutcome {
            val op = store.pending().find { it.id == opId } ?: return OpOutcome.Success
            return try {
                when (op) {
                    is PendingOp.Complete -> {
                        graph.completeTask(op.listId, op.taskId)
                        store.removePending(op.id)
                    }
                    is PendingOp.Create -> {
                        val created = graph.createTask(op.listId, op.title, op.important, op.dueDate, op.notes)
                        store.removePending(op.id, created)
                    }
                }
                signal()
                OpOutcome.Success
            } catch (e: SignInRequired) {
                // Keep the change; it goes out once the owner signs in again in the app.
                store.needsSignIn = true
                OpOutcome.Retry
            } catch (e: GraphHttpException) {
                when {
                    e.status == 404 -> {
                        // The task was deleted or moved elsewhere: nothing left to do.
                        store.removePending(op.id)
                        OpOutcome.Dropped
                    }
                    e.status == 408 || e.status == 429 || e.status >= 500 -> OpOutcome.Retry
                    else -> {
                        Log.w("Woutist", "Dropping pending ${op.javaClass.simpleName}: Graph ${e.status}")
                        store.removePending(op.id)
                        OpOutcome.Dropped
                    }
                }
            } catch (e: IOException) {
                OpOutcome.Retry
            }
        }

        fun enqueue(context: Context, opId: String, policy: ExistingWorkPolicy = ExistingWorkPolicy.KEEP) {
            val request = OneTimeWorkRequestBuilder<TaskOpWorker>()
                .setInputData(workDataOf(KEY_OP to opId))
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .addTag(TAG)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork("op:$opId", policy, request)
        }

        fun cancelAll(context: Context) {
            WorkManager.getInstance(context).cancelAllWorkByTag(TAG)
        }
    }
}
