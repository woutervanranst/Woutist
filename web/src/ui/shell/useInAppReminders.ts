import { useEffect, useRef } from 'react'
import { useServices } from '../../app/AppServices'
import { useSearchParams } from 'react-router'
import { isNative } from '../../platform/native'

/**
 * While the app is open: show reminders that come due (a toast-style callback, plus a system
 * notification when neither push nor the Android app handles them), and act on "Complete" from a notification.
 */
export function useInAppReminders(onReminder: (title: string, taskId: string, listId: string) => void) {
  const { db, push, repo } = useServices()
  const lastCheck = useRef(0)
  const [params, setParams] = useSearchParams()

  useEffect(() => {
    lastCheck.current = Date.now()
    const tick = async () => {
      const now = Date.now()
      const from = lastCheck.current
      lastCheck.current = now
      const due = await db.tasks
        .filter(
          (t) =>
            t.isReminderOn &&
            !t.completed &&
            t.reminderAt !== null &&
            Date.parse(t.reminderAt) > from &&
            Date.parse(t.reminderAt) <= now,
        )
        .toArray()
      for (const task of due) {
        onReminder(task.title, task.id, task.listId)
        // On Android the native alarm posts the notification; push handles it in browsers that enabled it.
        const pushHandles = isNative || push?.state() === 'on'
        if (!pushHandles && document.visibilityState !== 'visible' && Notification?.permission === 'granted') {
          const reg = await navigator.serviceWorker?.getRegistration()
          await reg?.showNotification(task.title, {
            body: 'Reminder',
            tag: `reminder:${task.id}`,
            data: { taskId: task.id, listId: task.listId },
          })
        }
      }
    }
    const id = setInterval(() => void tick(), 20_000)
    return () => clearInterval(id)
  }, [db, push, onReminder])

  // Notification action "Complete" arrives as ?task=<id>&complete=1.
  const completeId = params.get('complete') === '1' ? params.get('task') : null
  useEffect(() => {
    if (!completeId) return
    void (async () => {
      const task = await db.tasks.get(completeId)
      if (task && !task.completed) await repo.updateTask(task.id, { status: 'completed' })
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.delete('complete')
          return next
        },
        { replace: true },
      )
    })()
  }, [completeId, db, repo, setParams])
}
