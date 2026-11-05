package com.wouteronarchitecture.woutist.widget

import android.content.Context
import android.content.Intent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.glance.ColorFilter
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.action.ActionParameters
import androidx.glance.action.actionParametersOf
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.lazy.LazyColumn
import androidx.glance.appwidget.lazy.items
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.updateAll
import androidx.glance.background
import androidx.glance.color.ColorProvider
import androidx.glance.currentState
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.state.PreferencesGlanceStateDefinition
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import com.wouteronarchitecture.woutist.MainActivity
import com.wouteronarchitecture.woutist.R
import com.wouteronarchitecture.woutist.data.PendingOp
import com.wouteronarchitecture.woutist.data.SnapTask
import com.wouteronarchitecture.woutist.data.Snapshot
import com.wouteronarchitecture.woutist.data.SnapshotStore
import com.wouteronarchitecture.woutist.quickadd.QuickAddActivity
import com.wouteronarchitecture.woutist.reminders.Notifications
import com.wouteronarchitecture.woutist.work.TaskOpWorker
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.util.UUID

/** Brand colours for light and dark home screens. */
private object WidgetColors {
    val surface = ColorProvider(day = Color(0xFFF3F3F3), night = Color(0xFF1B1B1B))
    val row = ColorProvider(day = Color(0xFFFFFFFF), night = Color(0xFF2B2B2B))
    val brand = ColorProvider(day = Color(0xFF186DB6), night = Color(0xFF6CB0EC))
    val text = ColorProvider(day = Color(0xFF201F1E), night = Color(0xFFF3F2F1))
    val secondary = ColorProvider(day = Color(0xFF605E5C), night = Color(0xFFC8C6C4))
    val overdue = ColorProvider(day = Color(0xFFC50F1F), night = Color(0xFFF1707B))
}

/** A home-screen list of open tasks: a list, Important or Planned, picked per widget. */
class TaskListWidget : GlanceAppWidget() {
    override val stateDefinition = PreferencesGlanceStateDefinition

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val store = SnapshotStore.get(context)
        provideContent {
            val version by store.version.collectAsState()
            val source = WidgetSource.parse(currentState<Preferences>()[SOURCE] ?: "")
            val snapshot = remember(version) { store.current() }
            val needsSignIn = remember(version) { store.needsSignIn }
            WidgetBody(context, if (needsSignIn) null else snapshot, source)
        }
    }

    companion object {
        val SOURCE = stringPreferencesKey("source")
        private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

        /** Redraw every placed widget (after the snapshot or pending operations changed). */
        fun refreshAll(context: Context) {
            scope.launch { TaskListWidget().updateAll(context) }
        }
    }
}

@Composable
private fun WidgetBody(context: Context, snapshot: Snapshot?, source: WidgetSource) {
    Column(
        modifier = GlanceModifier.fillMaxSize().background(WidgetColors.surface).cornerRadius(16.dp).padding(6.dp),
    ) {
        Row(
            modifier = GlanceModifier.fillMaxWidth().padding(start = 8.dp, top = 2.dp, bottom = 6.dp)
                .clickable(actionStartActivity(openApp(context, WidgetContent.path(source)))),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                WidgetContent.title(snapshot, source),
                maxLines = 1,
                modifier = GlanceModifier.defaultWeight(),
                style = TextStyle(color = WidgetColors.brand, fontSize = 17.sp, fontWeight = FontWeight.Bold),
            )
            if (snapshot != null) {
                Image(
                    provider = ImageProvider(R.drawable.ic_widget_add),
                    contentDescription = "Add a task",
                    colorFilter = ColorFilter.tint(WidgetColors.brand),
                    modifier = GlanceModifier.size(28.dp).padding(2.dp).clickable(
                        actionStartActivity(
                            Intent(context, QuickAddActivity::class.java)
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                                .putExtra(QuickAddActivity.EXTRA_SOURCE, source.toJson()),
                        ),
                    ),
                )
            }
        }
        when {
            snapshot == null -> Message(context, "Open Woutist to sign in")
            else -> {
                val tasks = WidgetContent.tasks(snapshot, source)
                if (tasks.isEmpty()) {
                    Message(context, "No tasks", WidgetContent.path(source))
                } else {
                    val today = LocalDate.now()
                    LazyColumn {
                        items(tasks, itemId = { it.id.hashCode().toLong() }) { task ->
                            TaskRow(context, snapshot, source, task, today)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Message(context: Context, text: String, path: String = "/") {
    Box(
        modifier = GlanceModifier.fillMaxSize().clickable(actionStartActivity(openApp(context, path))),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = TextStyle(color = WidgetColors.secondary, fontSize = 14.sp))
    }
}

@Composable
private fun TaskRow(context: Context, snapshot: Snapshot, source: WidgetSource, task: SnapTask, today: LocalDate) {
    val due = WidgetContent.dueLabel(task, today)
    // Smart lists say which list a task is in, like the app.
    val listName = if (source is WidgetSource.Smart) WidgetContent.listName(snapshot, task.listId).ifEmpty { null } else null
    val subtitle = listOfNotNull(listName, due).joinToString(" · ").ifEmpty { null }
    Column(modifier = GlanceModifier.fillMaxWidth().padding(bottom = 2.dp)) {
        Row(
            modifier = GlanceModifier.fillMaxWidth().background(WidgetColors.row).cornerRadius(8.dp)
                .padding(horizontal = 8.dp, vertical = 5.dp)
                .clickable(actionStartActivity(openApp(context, Notifications.taskPath(task.listId, task.id)))),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val pending = task.id.startsWith(PendingOp.NATIVE_TMP_PREFIX)
            Image(
                provider = ImageProvider(R.drawable.ic_widget_circle),
                contentDescription = "Complete ${task.title}",
                colorFilter = ColorFilter.tint(WidgetColors.secondary),
                modifier = GlanceModifier.size(20.dp).let {
                    // A task still being created has no Graph id to complete yet.
                    if (pending) it else it.clickable(
                        actionRunCallback<CompleteTaskAction>(
                            actionParametersOf(CompleteTaskAction.TASK_ID to task.id, CompleteTaskAction.LIST_ID to task.listId),
                        ),
                    )
                },
            )
            Spacer(GlanceModifier.width(8.dp))
            Column(modifier = GlanceModifier.defaultWeight()) {
                Text(task.title, maxLines = 2, style = TextStyle(color = WidgetColors.text, fontSize = 14.sp))
                if (subtitle != null) {
                    Text(
                        subtitle,
                        maxLines = 1,
                        style = TextStyle(
                            color = if (WidgetContent.overdue(task, today)) WidgetColors.overdue else WidgetColors.secondary,
                            fontSize = 11.sp,
                        ),
                    )
                }
            }
            if (task.important) {
                Spacer(GlanceModifier.width(8.dp))
                Image(
                    provider = ImageProvider(R.drawable.ic_widget_star),
                    contentDescription = "Important",
                    colorFilter = ColorFilter.tint(WidgetColors.brand),
                    modifier = GlanceModifier.size(16.dp),
                )
            }
        }
    }
}

private fun openApp(context: Context, path: String): Intent =
    Intent(context, MainActivity::class.java)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        .putExtra(Notifications.EXTRA_URL, path)

/** The widget's circle: complete the task on the phone first, then in Graph. */
class CompleteTaskAction : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        val taskId = parameters[TASK_ID] ?: return
        val listId = parameters[LIST_ID] ?: return
        val op = PendingOp.Complete(UUID.randomUUID().toString(), listId, taskId)
        SnapshotStore.get(context).addPending(op)
        TaskOpWorker.enqueue(context, op.id)
    }

    companion object {
        val TASK_ID = ActionParameters.Key<String>("taskId")
        val LIST_ID = ActionParameters.Key<String>("listId")
    }
}
