import { formatTimeOfDay } from './dateReminder'
import { formatDate } from './presets'
import type { DateSettings } from './quickDates'
import { addDays, instantToZonedWall, userTimeZone, zonedWallToInstant } from './time'
import type { Task, TaskChanges } from './todo'

/**
 * The reminder bell: open tasks whose reminder has come due and that the user hasn't dismissed or
 * snoozed. Snoozing moves the reminder itself (it is saved to Microsoft To Do); dismissing is only
 * remembered on this device.
 */

/** Reminders older than this no longer count: a week-old overdue task is a task, not a reminder. */
export const DUE_REMINDER_DAYS = 7

/** Reminders already dismissed on this device: task id → the reminder time that was dismissed. */
export type DismissedReminders = Record<string, string>

const MINUTE = 60_000

/** Due, open, not dismissed: newest first. */
export function dueReminders(tasks: Task[], dismissed: DismissedReminders, now: Date = new Date()): Task[] {
  const from = now.getTime() - DUE_REMINDER_DAYS * 86_400_000
  return tasks
    .filter((t) => {
      if (!t.isReminderOn || !t.reminderAt || t.completed) return false
      const at = Date.parse(t.reminderAt)
      // A reminder moved to another time is a new reminder, whatever was dismissed before.
      return at <= now.getTime() && at > from && dismissed[t.id] !== t.reminderAt
    })
    .sort((a, b) => b.reminderAt!.localeCompare(a.reminderAt!) || a.id.localeCompare(b.id))
}

/** Keeps only the dismissals that still match a task's reminder, so the list can't grow forever. */
export function pruneDismissed(dismissed: DismissedReminders, tasks: Task[]): DismissedReminders {
  const current = new Map(tasks.map((t) => [t.id, t.reminderAt]))
  const keys = Object.keys(dismissed)
  const kept = keys.filter((id) => current.get(id) === dismissed[id])
  if (kept.length === keys.length) return dismissed
  return Object.fromEntries(kept.map((id) => [id, dismissed[id]]))
}

export interface SnoozeOption {
  id: '10m' | '1h' | 'later' | 'tomorrow'
  label: string
  /** `HH:MM` for the options that land on one of the user's reminder times. */
  time?: string
  at: Date
}

const FALLBACK_MORNING = '09:00'

/** Where "snooze" can send a reminder: soon, a later reminder time today, and tomorrow's first. */
export function snoozeOptions(
  settings: DateSettings,
  now: Date = new Date(),
  tz: string = userTimeZone(),
): SnoozeOption[] {
  const today = instantToZonedWall(now, tz).slice(0, 10)
  const wall = (date: string, time: string) => zonedWallToInstant(`${date}T${time}:00`, tz)
  const options: SnoozeOption[] = [
    { id: '10m', label: '10 minutes', at: new Date(now.getTime() + 10 * MINUTE) },
    { id: '1h', label: '1 hour', at: new Date(now.getTime() + 60 * MINUTE) },
  ]
  const later = settings.reminderTimes.find((time) => wall(today, time).getTime() > now.getTime())
  if (later) options.push({ id: 'later', label: 'Later today', time: later, at: wall(today, later) })
  const morning = settings.reminderTimes[0] ?? FALLBACK_MORNING
  options.push({ id: 'tomorrow', label: 'Tomorrow', time: morning, at: wall(addDays(today, 1), morning) })
  return options
}

/** The changes that move a task's reminder to `at` (and keep it on). */
export function snoozeChanges(at: Date): TaskChanges {
  return { reminderAt: at.toISOString(), isReminderOn: true }
}

/** "just now", "4 min ago", "3 hours ago", "2 days ago". */
export function formatAgo(reminderAt: string, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - Date.parse(reminderAt)) / MINUTE))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  const days = Math.floor(hours / 24)
  return `${days} ${days === 1 ? 'day' : 'days'} ago`
}

/** Toast after a snooze: "Snoozed until 18:00" or "Snoozed until 09:00, Tomorrow". */
export function describeSnooze(at: Date, today: string, tz: string = userTimeZone(), locale?: string): string {
  const wall = instantToZonedWall(at, tz)
  const time = formatTimeOfDay(wall.slice(11, 16), locale)
  const date = wall.slice(0, 10)
  return date === today ? `Snoozed until ${time}` : `Snoozed until ${time}, ${formatDate(date, today, locale)}`
}
