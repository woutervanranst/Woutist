package com.wouteronarchitecture.woutist.widget

import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import android.widget.ArrayAdapter
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.state.updateAppWidgetState
import androidx.glance.state.PreferencesGlanceStateDefinition
import androidx.lifecycle.lifecycleScope
import com.wouteronarchitecture.woutist.data.Snapshot
import com.wouteronarchitecture.woutist.data.SnapshotStore
import kotlinx.coroutines.launch

/** Picks what a widget shows: Tasks, Important, Planned, then the other lists (app order). */
class WidgetConfigActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val appWidgetId = intent?.extras?.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
            ?: AppWidgetManager.INVALID_APPWIDGET_ID
        // Backing out leaves no half-configured widget.
        setResult(RESULT_CANCELED, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId))
        if (appWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID) return finish()

        val snapshot = SnapshotStore.get(this).current()
        val choices = choices(snapshot)
        val pad = (16 * resources.displayMetrics.density).toInt()
        val layout = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(pad, pad, pad, 0) }
        layout.addView(TextView(this).apply {
            text = if (snapshot == null) "Open Woutist and sign in to pick one of your lists." else "Show in this widget"
            textSize = 18f
        })
        layout.addView(ListView(this).apply {
            adapter = ArrayAdapter(this@WidgetConfigActivity, android.R.layout.simple_list_item_1, choices.map { it.first })
            setOnItemClickListener { _, _, position, _ -> save(appWidgetId, choices[position].second) }
        })
        setContentView(layout)
    }

    private fun save(appWidgetId: Int, source: WidgetSource) {
        lifecycleScope.launch {
            val glanceId = GlanceAppWidgetManager(this@WidgetConfigActivity).getGlanceIdBy(appWidgetId)
            updateAppWidgetState(this@WidgetConfigActivity, PreferencesGlanceStateDefinition, glanceId) { prefs ->
                prefs.toMutablePreferences().apply { this[TaskListWidget.SOURCE] = source.toJson() }
            }
            TaskListWidget().update(this@WidgetConfigActivity, glanceId)
            setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId))
            finish()
        }
    }

    private fun choices(s: Snapshot?): List<Pair<String, WidgetSource>> {
        val default = s?.lists?.firstOrNull { it.wellknownListName == "defaultList" }
        val rank = { wellknown: String -> if (wellknown == "flaggedEmails") 0 else 1 }
        val others = s?.lists.orEmpty()
            .filter { it.wellknownListName != "defaultList" }
            .sortedBy { rank(it.wellknownListName) }
            .map { it.name to WidgetSource.List(it.id) }
        return listOf(
            (default?.name ?: "Tasks") to WidgetSource.List(default?.id.orEmpty()),
            "Important" to WidgetSource.Smart("important"),
            "Planned" to WidgetSource.Smart("planned"),
        ) + others
    }
}
