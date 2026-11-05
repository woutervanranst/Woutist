package com.wouteronarchitecture.woutist.quickadd

import android.content.Intent
import android.os.Bundle
import android.view.KeyEvent
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.wouteronarchitecture.woutist.data.SnapshotStore
import com.wouteronarchitecture.woutist.widget.WidgetContent
import com.wouteronarchitecture.woutist.widget.WidgetSource
import com.wouteronarchitecture.woutist.work.TaskOpWorker
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID

/**
 * "Add a task" over whatever is on screen: from the widget's "+" (for that widget's list), the
 * launcher shortcut, or text shared from another app. Nothing is added until the user confirms.
 */
class QuickAddActivity : AppCompatActivity() {
    private lateinit var input: EditText

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val store = SnapshotStore.get(this)
        val snapshot = store.current()?.takeIf { !store.needsSignIn }
        val source = intent.getStringExtra(EXTRA_SOURCE)?.let(WidgetSource::parse) ?: WidgetSource.List("")
        val (sharedTitle, sharedNotes) = SharedText.parse(
            intent.getStringExtra(Intent.EXTRA_SUBJECT) ?: intent.getStringExtra(EXTRA_SUBJECT),
            intent.getStringExtra(Intent.EXTRA_TEXT) ?: intent.getStringExtra(EXTRA_TEXT),
        )
        val listName = snapshot?.let { s -> WidgetContent.listIdFor(s, source)?.let { WidgetContent.listName(s, it) } }

        val pad = (20 * resources.displayMetrics.density).toInt()
        val layout = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(pad, pad, pad, pad / 2) }
        layout.addView(TextView(this).apply {
            text = when {
                snapshot == null -> "Open Woutist to sign in"
                source is WidgetSource.Smart && source.id == "important" -> "Add to $listName, starred"
                source is WidgetSource.Smart && source.id == "planned" -> "Add to $listName, due today"
                else -> "Add to $listName"
            }
            textSize = 16f
        })
        input = EditText(this).apply {
            hint = "Add a task"
            setText(sharedTitle)
            setSelection(text.length)
            isSingleLine = true
            imeOptions = EditorInfo.IME_ACTION_DONE
            isEnabled = snapshot != null
        }
        layout.addView(input)
        val add = Button(this).apply {
            text = "Add"
            isEnabled = snapshot != null
            setOnClickListener { submit(source, sharedNotes) }
        }
        layout.addView(add)
        input.setOnEditorActionListener { _, actionId, event ->
            val enter = actionId == EditorInfo.IME_ACTION_DONE || (event?.keyCode == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_DOWN)
            if (enter && add.isEnabled) submit(source, sharedNotes)
            enter
        }
        setContentView(layout)
        window.setLayout((resources.displayMetrics.widthPixels * 0.9).toInt(), WindowManager.LayoutParams.WRAP_CONTENT)
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE)
        input.requestFocus()
    }

    private fun submit(source: WidgetSource, notes: String?) {
        val store = SnapshotStore.get(this)
        val snapshot = store.current() ?: return finish()
        val today = LocalDate.now(ZoneId.systemDefault())
        val op = QuickAdd.create(snapshot, source, input.text.toString(), notes, today, UUID.randomUUID().toString()) ?: return
        store.addPending(op)
        TaskOpWorker.enqueue(this, op.id)
        Toast.makeText(this, "Added to ${WidgetContent.listName(snapshot, op.listId)}", Toast.LENGTH_SHORT).show()
        finish()
    }

    companion object {
        /** The widget's [WidgetSource] as JSON; Tasks when absent. */
        const val EXTRA_SOURCE = "source"
        const val EXTRA_SUBJECT = "subject"
        const val EXTRA_TEXT = "text"
    }
}
