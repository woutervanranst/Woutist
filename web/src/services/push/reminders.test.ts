import { describe, expect, it } from 'vitest'
import { newLocalTask, type Task } from '../../models/todo'
import { desiredReminders, fingerprint, pastReminders } from './reminders'

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

describe('pastReminders', () => {
  it('lists the open, synced tasks whose reminder has come due, oldest first', () => {
    const tasks = [
      t('a', { isReminderOn: true, reminderAt: '2026-11-04T11:00:00.000Z' }),
      t('b', { isReminderOn: true, reminderAt: '2026-10-01T08:00:00.000Z' }), // weeks ago: still listed
      t('c', { isReminderOn: false, reminderAt: '2026-11-04T10:00:00.000Z' }),
      t('d', { isReminderOn: true, reminderAt: '2026-11-04T10:00:00.000Z', completed: 1 }),
      t('tmp_e', { isReminderOn: true, reminderAt: '2026-11-04T10:00:00.000Z' }),
      t('f', { isReminderOn: true, reminderAt: '2026-11-04T13:00:00.000Z' }), // still ahead
      t('g', { isReminderOn: true, reminderAt: '2026-11-04T12:00:00.000Z' }), // due right now
    ]
    expect(pastReminders(tasks, now).map((x) => x.id)).toEqual(['b', 'a', 'g'])
  })
})
