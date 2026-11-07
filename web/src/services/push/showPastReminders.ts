import type { Task } from '../../models/todo'
import { pastReminders } from './reminders'

/**
 * Shows a notification for every open task whose reminder has come due, as the service worker does for
 * a push (same tag, so a reminder that is still on screen is replaced, not doubled). Returns how many.
 */
export async function showPastReminders(tasks: Task[], now: Date = new Date()): Promise<number> {
  const due = pastReminders(tasks, now)
  if (due.length === 0) return 0
  const registration = await navigator.serviceWorker.ready
  for (const task of due) {
    await registration.showNotification(task.title || 'Reminder', {
      body: 'Reminder',
      tag: `reminder:${task.id}`,
      icon: '/pwa-192x192.png',
      badge: '/pwa-64x64.png',
      data: { taskId: task.id, listId: task.listId },
      actions: [
        { action: 'complete', title: 'Complete' },
        { action: 'open', title: 'Open' },
      ],
    } as NotificationOptions)
  }
  return due.length
}
