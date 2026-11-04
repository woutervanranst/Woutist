import { LIMITS, type ReminderDto } from '@woutist/contracts'
import type { Task } from '../../models/todo'
import { isTempId } from '../../models/todo'

/** Upcoming reminders the push service should fire (only ids and times leave the device). */
export function desiredReminders(tasks: Task[], now: Date = new Date()): ReminderDto[] {
  const from = now.getTime() - 60_000
  const until = now.getTime() + LIMITS.reminderHorizonDays * 86_400_000
  return tasks
    .filter((t) => t.isReminderOn && t.reminderAt && !t.completed && !isTempId(t.id) && !isTempId(t.listId))
    .map((t) => ({ taskId: t.id, listId: t.listId, fireAt: new Date(t.reminderAt!).toISOString() }))
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
