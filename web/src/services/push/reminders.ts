import { LIMITS, type ReminderDto } from '@woutist/contracts'
import type { Task } from '../../models/todo'
import { isTempId } from '../../models/todo'

/** Upcoming reminders the push service should fire (only ids and times leave the device). */
export function desiredReminders(tasks: Task[], now: Date = new Date()): ReminderDto[] {
  return upcomingReminders(
    tasks
      .filter((t) => t.isReminderOn && t.reminderAt && !t.completed && !isTempId(t.id) && !isTempId(t.listId))
      .map((t) => ({ taskId: t.id, listId: t.listId, fireAt: new Date(t.reminderAt!).toISOString() })),
    now,
  )
}

/**
 * The reminder window shared by Web Push and the Android app: fire times after now − 60 s and at
 * most 90 days ahead, sorted by time then task id, capped at 1000.
 */
export function upcomingReminders(candidates: ReminderDto[], now: Date): ReminderDto[] {
  const from = now.getTime() - 60_000
  const until = now.getTime() + LIMITS.reminderHorizonDays * 86_400_000
  return candidates
    .filter((r) => {
      const at = Date.parse(r.fireAt)
      return at > from && at <= until
    })
    .sort((a, b) => a.fireAt.localeCompare(b.fireAt) || a.taskId.localeCompare(b.taskId))
    .slice(0, LIMITS.maxRemindersPerUser)
}

export function fingerprint(reminders: ReminderDto[]): string {
  return reminders.map((r) => `${r.taskId}@${r.fireAt}`).join('|')
}

/**
 * Open tasks whose reminder has already come due, oldest first: what "show past reminders again"
 * notifies. (The Android app applies the same rule to its snapshot, in `ReminderRules.pastDue`.)
 */
export function pastReminders(tasks: Task[], now: Date = new Date()): Task[] {
  return tasks
    .filter((t) => t.isReminderOn && t.reminderAt && !t.completed && !isTempId(t.id) && !isTempId(t.listId))
    .filter((t) => Date.parse(t.reminderAt!) <= now.getTime())
    .sort((a, b) => a.reminderAt!.localeCompare(b.reminderAt!) || a.id.localeCompare(b.id))
}
