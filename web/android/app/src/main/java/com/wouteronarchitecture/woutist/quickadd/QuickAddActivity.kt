package com.wouteronarchitecture.woutist.quickadd

import android.app.DatePickerDialog
import android.app.TimePickerDialog
import android.content.Intent
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.format.DateFormat
import android.text.style.ForegroundColorSpan
import android.text.style.StyleSpan
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.ViewGroup
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.annotation.DrawableRes
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.PopupMenu
import androidx.core.content.ContextCompat
import com.wouteronarchitecture.woutist.R
import com.wouteronarchitecture.woutist.data.DateSettings
import com.wouteronarchitecture.woutist.data.SnapshotStore
import com.wouteronarchitecture.woutist.widget.WidgetContent
import com.wouteronarchitecture.woutist.widget.WidgetSource
import com.wouteronarchitecture.woutist.work.TaskOpWorker
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.UUID

/**
 * "Add a task" over whatever is on screen: from the widget's "+" (for that widget's list), the
 * launcher shortcut, or text shared from another app. Like the app, one control sets the date (your
 * quick dates from Settings) and, optionally, a reminder hour on that date. Nothing is added until
 * the user confirms.
 */
class QuickAddActivity : AppCompatActivity() {
    private lateinit var input: EditText
    private lateinit var dateButton: Button
    private lateinit var remindHint: TextView
    private lateinit var chips: FlowRow
    private val zone: ZoneId = ZoneId.systemDefault()
    private var settings: DateSettings = DateSettings.DEFAULT
    private var due: LocalDate? = null
    /** The reminder's hour, on [due]. */
    private var remind: LocalTime? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val store = SnapshotStore.get(this)
        val snapshot = store.current()?.takeIf { !store.needsSignIn }
        settings = snapshot?.dates ?: DateSettings.DEFAULT
        val source = intent.getStringExtra(EXTRA_SOURCE)?.let(WidgetSource::parse) ?: WidgetSource.List("")
        val (sharedTitle, sharedNotes) = SharedText.parse(
            intent.getStringExtra(Intent.EXTRA_SUBJECT) ?: intent.getStringExtra(EXTRA_SUBJECT),
            intent.getStringExtra(Intent.EXTRA_TEXT) ?: intent.getStringExtra(EXTRA_TEXT),
        )
        val listName = snapshot?.let { s -> WidgetContent.listIdFor(s, source)?.let { WidgetContent.listName(s, it) } }
        due = QuickAdd.initialDue(source, today())

        val pad = dp(20)
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

        dateButton = Button(this, null, android.R.attr.borderlessButtonStyle).apply {
            isAllCaps = false
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            setTextColor(ContextCompat.getColor(this@QuickAddActivity, R.color.woutist_brand))
            setCompoundDrawablesRelativeWithIntrinsicBounds(icon(R.drawable.ic_date_calendar, R.color.woutist_brand), null, null, null)
            compoundDrawablePadding = dp(8)
            setOnClickListener { showDateMenu() }
        }
        remindHint = TextView(this).apply {
            textSize = 13f
            setCompoundDrawablesRelativeWithIntrinsicBounds(icon(R.drawable.ic_date_alert, R.color.quick_add_muted, 16), null, null, null)
            compoundDrawablePadding = dp(6)
            setPadding(dp(4), dp(4), 0, dp(6))
        }
        chips = FlowRow(this, hGap = dp(6), vGap = dp(6))
        if (snapshot != null) {
            layout.addView(dateButton)
            layout.addView(remindHint)
            layout.addView(chips)
        }
        val add = Button(this).apply {
            text = "Add"
            isEnabled = snapshot != null
            setOnClickListener { submit(source, sharedNotes) }
        }
        layout.addView(add, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) })
        input.setOnEditorActionListener { _, actionId, event ->
            val enter = actionId == EditorInfo.IME_ACTION_DONE || (event?.keyCode == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_DOWN)
            if (enter && add.isEnabled) submit(source, sharedNotes)
            enter
        }
        refresh()
        setContentView(layout)
        window.setLayout((resources.displayMetrics.widthPixels * 0.9).toInt(), WindowManager.LayoutParams.WRAP_CONTENT)
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE)
        input.requestFocus()
    }

    private fun today(): LocalDate = LocalDate.now(zone)

    private fun dp(value: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics).toInt()

    private fun icon(@DrawableRes id: Int, color: Int? = null, sizeDp: Int = 20) = ContextCompat.getDrawable(this, id)!!.mutate().apply {
        if (color != null) setTint(ContextCompat.getColor(this@QuickAddActivity, color))
        setBounds(0, 0, dp(sizeDp), dp(sizeDp))
    }

    private fun is24Hour() = DateFormat.is24HourFormat(this)

    private fun refresh() {
        val today = today()
        dateButton.text = due?.let { QuickAddPresets.dueLabel(it, today) } ?: "Add date"
        remindHint.text = SpannableStringBuilder().apply {
            append("Remind me", StyleSpan(Typeface.BOLD), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            append("  ")
            append(
                QuickAddPresets.remindHint(due, today),
                ForegroundColorSpan(ContextCompat.getColor(this@QuickAddActivity, R.color.quick_add_muted)),
                Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
            )
        }
        chips.removeAllViews()
        chips.addView(chip("None", "No reminder", remind == null) { setTime(null) })
        for (t in settings.reminderTimes) {
            val label = QuickAddPresets.timeLabel(t, is24Hour())
            chips.addView(chip(label, "Remind me at $label", remind == t) { setTime(t) })
        }
        val custom = remind?.takeIf { it !in settings.reminderTimes }?.let { QuickAddPresets.timeLabel(it, is24Hour()) }
        chips.addView(chip(custom ?: "Other", custom?.let { "Other time, $it" } ?: "Other time", custom != null, R.drawable.ic_date_clock) { pickTime() })
    }

    /** A pill like the app's reminder chips; the selected one is filled. */
    private fun chip(label: String, description: String, selected: Boolean, @DrawableRes iconId: Int? = null, onClick: () -> Unit) = TextView(this).apply {
        val brand = ContextCompat.getColor(this@QuickAddActivity, R.color.woutist_brand)
        val textColor = if (selected) 0xFFFFFFFF.toInt() else ContextCompat.getColor(this@QuickAddActivity, R.color.quick_add_chip_text)
        text = label
        textSize = 14f
        setTypeface(typeface, Typeface.BOLD)
        setTextColor(textColor)
        gravity = Gravity.CENTER
        minHeight = dp(36)
        setPadding(dp(14), 0, dp(14), 0)
        background = GradientDrawable().apply {
            cornerRadius = dp(18).toFloat()
            if (selected) setColor(brand) else setStroke(dp(1), ContextCompat.getColor(this@QuickAddActivity, R.color.quick_add_chip_stroke))
        }
        if (iconId != null) {
            setCompoundDrawablesRelative(ContextCompat.getDrawable(context, iconId)!!.mutate().apply { setTint(textColor); setBounds(0, 0, dp(16), dp(16)) }, null, null, null)
            compoundDrawablePadding = dp(4)
        }
        contentDescription = description
        isSelected = selected
        isClickable = true
        isFocusable = true
        setOnClickListener { onClick() }
        layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(36))
    }

    private fun setDate(date: LocalDate?) {
        due = date
        remind = date?.let { QuickDates.reminderFor(it, remind, settings, ZonedDateTime.now(zone)) }
        refresh()
    }

    /** A reminder hour on the date; without a date, the task is due today. */
    private fun setTime(time: LocalTime?) {
        remind = time
        if (time != null && due == null) due = today()
        refresh()
    }

    private fun pickTime() {
        val start = remind ?: settings.reminderTimes.firstOrNull() ?: LocalTime.of(9, 0)
        TimePickerDialog(this, { _, h, m -> setTime(LocalTime.of(h, m)) }, start.hour, start.minute, is24Hour()).show()
    }

    private fun showDateMenu() {
        val today = today()
        val options = QuickDates.options(settings, today)
        PopupMenu(this, dateButton).apply {
            options.forEachIndexed { i, o ->
                menu.add(0, i, i, "${o.label}  ·  ${QuickDates.hint(o.date, today)}").setIcon(quickIcon(o.visual))
            }
            menu.add(0, PICK, options.size, "Pick a date…").setIcon(icon(R.drawable.ic_date_calendar, R.color.quick_add_muted))
            if (due != null) menu.add(0, CLEAR, options.size + 1, "Remove date").setIcon(R.drawable.ic_quick_none)
            setForceShowIcon(true)
            setOnMenuItemClickListener { item ->
                when (item.itemId) {
                    PICK -> pickDate(due ?: today) { setDate(it) }
                    CLEAR -> setDate(null)
                    else -> setDate(options[item.itemId].date)
                }
                true
            }
        }.show()
    }

    private fun quickIcon(visual: QuickDateVisual): Int = when (visual) {
        QuickDateVisual.TODAY -> R.drawable.ic_quick_today
        QuickDateVisual.TOMORROW -> R.drawable.ic_quick_tomorrow
        QuickDateVisual.DAY_AFTER -> R.drawable.ic_quick_day_after
        QuickDateVisual.WEEKEND -> R.drawable.ic_quick_weekend
        QuickDateVisual.NEXT_WEEK -> R.drawable.ic_quick_next_week
        QuickDateVisual.IN_WEEK -> R.drawable.ic_quick_in_week
        QuickDateVisual.DAYS -> R.drawable.ic_quick_days
        QuickDateVisual.WEEKS -> R.drawable.ic_quick_weeks
        QuickDateVisual.WEEKDAY -> R.drawable.ic_quick_weekday
    }

    private fun pickDate(initial: LocalDate, onPicked: (LocalDate) -> Unit) {
        DatePickerDialog(this, { _, y, m, d -> onPicked(LocalDate.of(y, m + 1, d)) }, initial.year, initial.monthValue - 1, initial.dayOfMonth).show()
    }

    private fun submit(source: WidgetSource, notes: String?) {
        val store = SnapshotStore.get(this)
        val snapshot = store.current() ?: return finish()
        val reminderAt = due?.let { d -> remind?.let { d.atTime(it).atZone(zone).toInstant() } }
        val op = QuickAdd.create(snapshot, source, input.text.toString(), notes, due, reminderAt, UUID.randomUUID().toString()) ?: return
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
