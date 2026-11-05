package com.wouteronarchitecture.woutist.quickadd

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.content.Intent
import android.os.Bundle
import android.text.format.DateFormat
import android.view.KeyEvent
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.PopupMenu
import androidx.core.content.ContextCompat
import com.wouteronarchitecture.woutist.R
import com.wouteronarchitecture.woutist.data.SnapshotStore
import com.wouteronarchitecture.woutist.widget.WidgetContent
import com.wouteronarchitecture.woutist.widget.WidgetSource
import com.wouteronarchitecture.woutist.work.TaskOpWorker
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.UUID

/**
 * "Add a task" over whatever is on screen: from the widget's "+" (for that widget's list), the
 * launcher shortcut, or text shared from another app. Like the official app, a due date and a
 * reminder can be set right away. Nothing is added until the user confirms.
 */
class QuickAddActivity : AppCompatActivity() {
    private lateinit var input: EditText
    private lateinit var dueButton: Button
    private lateinit var remindButton: Button
    private val zone: ZoneId = ZoneId.systemDefault()
    private var due: LocalDate? = null
    private var remind: ZonedDateTime? = null

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
        due = QuickAdd.initialDue(source, today())

        val pad = (20 * resources.displayMetrics.density).toInt()
        val layout = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(pad, pad, pad, pad / 2) }
        layout.addView(TextView(this).apply {
            text = when {
                snapshot == null -> "Open Woutist to sign in"
                source is WidgetSource.Smart && source.id == "important" -> "Add to $listName, starred"
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
        val options = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        dueButton = optionButton { showDueMenu() }
        remindButton = optionButton { showReminderMenu() }
        options.addView(dueButton)
        options.addView(remindButton)
        if (snapshot != null) layout.addView(options)
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
        refreshOptions()
        setContentView(layout)
        window.setLayout((resources.displayMetrics.widthPixels * 0.9).toInt(), WindowManager.LayoutParams.WRAP_CONTENT)
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE)
        input.requestFocus()
    }

    private fun today(): LocalDate = LocalDate.now(zone)

    private fun optionButton(onClick: () -> Unit) = Button(this, null, android.R.attr.borderlessButtonStyle).apply {
        isAllCaps = false
        setTextColor(ContextCompat.getColor(this@QuickAddActivity, R.color.woutist_brand))
        setOnClickListener { onClick() }
    }

    private fun refreshOptions() {
        val today = today()
        dueButton.text = due?.let { QuickAddPresets.dueLabel(it, today) } ?: "Add due date"
        remindButton.text = remind?.let { QuickAddPresets.reminderLabel(it, today) } ?: "Remind me"
    }

    private fun showDueMenu() {
        val today = today()
        val presets = QuickAddPresets.due(today)
        val day = DateTimeFormatter.ofPattern("EEE d MMM", Locale.getDefault())
        PopupMenu(this, dueButton).apply {
            presets.forEachIndexed { i, p -> menu.add(0, i, i, "${p.label}  ·  ${p.date.format(day)}") }
            menu.add(0, PICK, presets.size, "Pick a date…")
            if (due != null) menu.add(0, CLEAR, presets.size + 1, "Remove due date")
            setOnMenuItemClickListener { item ->
                when (item.itemId) {
                    PICK -> pickDate(due ?: today) { due = it; refreshOptions() }
                    CLEAR -> due = null
                    else -> due = presets[item.itemId].date
                }
                refreshOptions()
                true
            }
        }.show()
    }

    private fun showReminderMenu() {
        val now = ZonedDateTime.now(zone)
        val presets = QuickAddPresets.reminders(now)
        PopupMenu(this, remindButton).apply {
            presets.forEachIndexed { i, p -> menu.add(0, i, i, "${p.label}  ·  ${QuickAddPresets.menuHint(p.at, now.toLocalDate())}") }
            menu.add(0, PICK, presets.size, "Pick a date & time…")
            if (remind != null) menu.add(0, CLEAR, presets.size + 1, "Remove reminder")
            setOnMenuItemClickListener { item ->
                when (item.itemId) {
                    PICK -> pickDate(remind?.toLocalDate() ?: now.toLocalDate()) { date ->
                        val start = remind?.toLocalTime() ?: LocalTime.of(9, 0)
                        TimePickerDialog(this@QuickAddActivity, { _, h, m ->
                            remind = date.atTime(h, m).atZone(zone)
                            refreshOptions()
                        }, start.hour, start.minute, DateFormat.is24HourFormat(this@QuickAddActivity)).show()
                    }
                    CLEAR -> remind = null
                    else -> remind = presets[item.itemId].at
                }
                refreshOptions()
                true
            }
        }.show()
    }

    private fun pickDate(initial: LocalDate, onPicked: (LocalDate) -> Unit) {
        DatePickerDialog(this, { _, y, m, d -> onPicked(LocalDate.of(y, m + 1, d)) }, initial.year, initial.monthValue - 1, initial.dayOfMonth).show()
    }

    private fun submit(source: WidgetSource, notes: String?) {
        val store = SnapshotStore.get(this)
        val snapshot = store.current() ?: return finish()
        val op = QuickAdd.create(snapshot, source, input.text.toString(), notes, due, remind?.toInstant(), UUID.randomUUID().toString()) ?: return
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
        private const val PICK = 100
        private const val CLEAR = 101
    }
}
