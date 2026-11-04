import { useEffect, useRef } from 'react'
import { useServices } from '../../app/AppServices'
import { useSearchParams } from 'react-router'

/**
 * While the app is open: show reminders that come due (a toast-style callback, plus a system
 * notification when push isn't handling them), and act on "Complete" from a notification.
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
        const pushHandles = push?.state() === 'on'
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
