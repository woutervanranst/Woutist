import { Link, Toast, ToastTitle, ToastTrigger, useToastController } from '@fluentui/react-components'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useServices } from '../../app/AppServices'
import {
  type DateFields,
  changesForDate,
  changesForTime,
  dateFields,
  describeDateChange,
  restoreChanges,
  sameDateFields,
} from '../../models/dateReminder'
import { todayLocal } from '../../models/time'
import type { Task, TaskChanges } from '../../models/todo'
import { useDateSettings } from '../hooks'

export interface DateEditor {
  /** Start an editing session (the picker, menu or sheet opened). */
  begin: () => void
  pickDate: (date: string | null) => void
  pickTime: (time: string | null) => void
  /** End the session: if anything changed, a toast says what, with Undo. */
  end: () => void
}

function apply(current: DateFields, changes: TaskChanges): DateFields {
  const next = { ...current, ...changes } as DateFields
  if (changes.dueDate === null && changes.recurrence === undefined) next.recurrence = null
  return next
}

/**
 * Date and reminder edits for one task. Changes apply immediately; the picker stays open for more.
 * Successive picks build on each other even before the database has caught up.
 */
export function useDateEditor(task: Task): DateEditor {
  const { repo, db } = useServices()
  const [settings] = useDateSettings()
  const { dispatchToast } = useToastController('app')
  const latest = useRef({ task, settings })
  useLayoutEffect(() => {
    latest.current = { task, settings }
  })
  const before = useRef<DateFields | null>(null)
  const pending = useRef<DateFields | null>(null)

  // Once the stored task shows our edits, read from it again.
  useEffect(() => {
    if (pending.current && sameDateFields(pending.current, dateFields(task))) pending.current = null
  }, [task])

  const current = useCallback(() => pending.current ?? dateFields(latest.current.task), [])

  const change = useCallback(
    (changes: TaskChanges) => {
      if (!before.current) before.current = dateFields(latest.current.task)
      pending.current = apply(current(), changes)
      void repo.updateTask(latest.current.task.id, changes)
    },
    [repo, current],
  )

  const undo = useCallback(
    async (taskId: string, snapshot: DateFields) => {
      const id = (await db.tasks.get(taskId)) ? taskId : ((await db.getMeta<string>(`alias:${taskId}`)) ?? taskId)
      const now = await db.tasks.get(id)
      if (now) await repo.updateTask(id, restoreChanges(now, snapshot))
    },
    [db, repo],
  )

  return useMemo<DateEditor>(
    () => ({
      begin: () => {
        before.current = current()
      },
      pickDate: (date) => change(changesForDate(current(), date, latest.current.settings)),
      pickTime: (time) => change(changesForTime(current(), time)),
      end: () => {
        const snapshot = before.current
        before.current = null
        if (!snapshot) return
        const after = current()
        if (sameDateFields(after, snapshot)) return
        const taskId = latest.current.task.id
        dispatchToast(
          <Toast>
            <ToastTitle
              action={
                <ToastTrigger>
                  <Link onClick={() => void undo(taskId, snapshot)}>Undo</Link>
                </ToastTrigger>
              }
            >
              {describeDateChange(after, todayLocal())}
            </ToastTitle>
          </Toast>,
          { timeout: 5000 },
        )
      },
    }),
    [change, current, dispatchToast, undo],
  )
}
