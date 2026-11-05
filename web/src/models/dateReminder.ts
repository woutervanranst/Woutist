import { formatDate } from './presets'
import type { DateSettings } from './quickDates'
import { daysBetween, instantToZonedWall, todayLocal, userTimeZone, zonedWallToInstant } from './time'
import type { Task, TaskChanges } from './todo'

/**
 * The merged date + reminder control: a task has a due date and, optionally, a reminder at an hour
 * on that date. Graph keeps the reminder as an independent instant, so these helpers translate.
 */

export type DateFields = Pick<Task, 'dueDate' | 'reminderAt' | 'isReminderOn' | 'recurrence'>

/** The reminder as wall-clock date and time in `tz`, or null when the task has none. */
export function reminderWall(task: Pick<Task, 'reminderAt' | 'isReminderOn'>, tz = userTimeZone()) {
  if (!task.isReminderOn || !task.reminderAt) return null
  const wall = instantToZonedWall(new Date(task.reminderAt), tz)
  return { date: wall.slice(0, 10), time: wall.slice(11, 16) }
}

const at = (date: string, time: string, tz: string) => zonedWallToInstant(`${date}T${time}:00`, tz).toISOString()

/**
 * Set the due date (null removes the date and the reminder). An existing reminder keeps its hour
 * on the new date. Without one, the "first reminder time" rule may add one, unless that's already past.
 */
export function changesForDate(
  task: DateFields,
  date: string | null,
  settings: DateSettings,
  tz = userTimeZone(),
  now: Date = new Date(),
): TaskChanges {
  if (!date) return { dueDate: null, reminderAt: null, isReminderOn: false }
  const reminder = reminderWall(task, tz)
  if (reminder) return { dueDate: date, reminderAt: at(date, reminder.time, tz), isReminderOn: true }
  const first = settings.reminderTimes[0]
  if (settings.newReminder === 'first' && first) {
    const instant = at(date, first, tz)
    if (Date.parse(instant) > now.getTime()) return { dueDate: date, reminderAt: instant, isReminderOn: true }
  }
  return { dueDate: date }
}

/** Set the reminder to `time` on the due date (null removes it). A task without a date gets today. */
export function changesForTime(
  task: DateFields,
  time: string | null,
  tz = userTimeZone(),
  today: string = todayLocal(new Date(), tz),
): TaskChanges {
  if (!time) return { reminderAt: null, isReminderOn: false }
  const date = task.dueDate ?? today
  return { ...(task.dueDate ? {} : { dueDate: date }), reminderAt: at(date, time, tz), isReminderOn: true }
}

/** The fields to send to put a task's date, reminder and repeat back the way they were. */
export function restoreChanges(current: DateFields, before: DateFields): TaskChanges {
  const out: TaskChanges = {}
  if (current.dueDate !== before.dueDate) out.dueDate = before.dueDate
  if (current.reminderAt !== before.reminderAt || current.isReminderOn !== before.isReminderOn) {
    out.reminderAt = before.reminderAt
    out.isReminderOn = before.isReminderOn
  }
  if (JSON.stringify(current.recurrence) !== JSON.stringify(before.recurrence)) out.recurrence = before.recurrence
  return out
}

export const dateFields = (task: DateFields): DateFields => ({
  dueDate: task.dueDate,
  reminderAt: task.reminderAt,
  isReminderOn: task.isReminderOn,
  recurrence: task.recurrence,
})

export function sameDateFields(a: DateFields, b: DateFields): boolean {
  return Object.keys(restoreChanges(a, b)).length === 0
}

// ---------- display ----------

/** `HH:MM` → "9:00" (in the user's locale, like other times in the app). */
export function formatTimeOfDay(time: string, locale?: string): string {
  const [h, m] = time.split(':').map(Number)
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2000, 0, 1, h, m)),
  )
}

const utcDate = (date: string) => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

/** "Thu, Nov 5" (the year only when it isn't this year): a date without "Today"/"Tomorrow". */
export function formatFullDate(date: string, today: string = todayLocal(), locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: date.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric',
    timeZone: 'UTC',
  }).format(utcDate(date))
}

/** Hint next to a quick date: the weekday within the coming week, else the date. */
export function quickDateHint(date: string, today: string, locale?: string): string {
  const n = daysBetween(today, date)
  if (n >= 0 && n < 7) return new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(utcDate(date))
  return formatFullDate(date, today, locale)
}

/**
 * The reminder in words, relative to the due date: "9:00" when it's on the due date, else
 * "9:00, Tomorrow". Null without a reminder.
 */
export function reminderLabel(task: DateFields, today: string, tz = userTimeZone(), locale?: string): string | null {
  const reminder = reminderWall(task, tz)
  if (!reminder) return null
  const time = formatTimeOfDay(reminder.time, locale)
  return reminder.date === task.dueDate ? time : `${time}, ${formatDate(reminder.date, today, locale)}`
}

/** Toast after an edit: "Moved to Tomorrow · 9:00", "Date removed". */
export function describeDateChange(task: DateFields, today: string, tz = userTimeZone(), locale?: string): string {
  if (!task.dueDate) {
    const reminder = reminderLabel(task, today, tz, locale)
    return reminder ? `Reminder at ${reminder}` : 'Date removed'
  }
  const reminder = reminderLabel(task, today, tz, locale)
  return `Moved to ${formatDate(task.dueDate, today, locale)}${reminder ? ` · ${reminder}` : ''}`
}
