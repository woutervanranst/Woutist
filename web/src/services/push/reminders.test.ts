import { describe, expect, it } from 'vitest'
import { newLocalTask, type Task } from '../../models/todo'
import { desiredReminders, fingerprint } from './reminders'

const t = (id: string, extra: Partial<Task>): Task => ({ ...newLocalTask('L1', id), id, ...extra })
const now = new Date('2026-11-04T12:00:00Z')

describe('desiredReminders', () => {
  it('keeps upcoming, enabled reminders of open, synced tasks only', () => {
    const tasks = [
      t('a', { isReminderOn: true, reminderAt: '2026-11-04T15:00:00.000Z' }),
      t('b', { isReminderOn: false, reminderAt: '2026-11-04T15:00:00.000Z' }),
      t('c', { isReminderOn: true, reminderAt: '2026-11-04T11:00:00.000Z' }), // past
      t('d', { isReminderOn: true, reminderAt: '2026-11-05T09:00:00.000Z', completed: 1 }),
      t('tmp_e', { isReminderOn: true, reminderAt: '2026-11-05T09:00:00.000Z' }), // not synced yet
      t('f', { isReminderOn: true, reminderAt: '2027-06-01T09:00:00.000Z' }), // beyond 90 days
      t('g', { isReminderOn: true, reminderAt: '2026-11-04T13:00:00.000Z' }),
    ]
    const result = desiredReminders(tasks, now)
    expect(result).toEqual([
      { taskId: 'g', listId: 'L1', fireAt: '2026-11-04T13:00:00.000Z' },
      { taskId: 'a', listId: 'L1', fireAt: '2026-11-04T15:00:00.000Z' },
    ])
    expect(fingerprint(result)).toBe('g@2026-11-04T13:00:00.000Z|a@2026-11-04T15:00:00.000Z')
  })
})
