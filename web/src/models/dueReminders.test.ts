import { describe, expect, it } from 'vitest'
import { DEFAULT_DATE_SETTINGS } from './quickDates'
import { zonedWallToInstant } from './time'
import { newLocalTask, type Task } from './todo'
import {
  describeSnooze,
  dueReminders,
  formatAgo,
  pruneDismissed,
  snoozeOptions,
} from './dueReminders'

const TZ = 'Europe/Brussels'
const at = (wall: string) => zonedWallToInstant(wall, TZ)
const NOW = at('2026-11-10T14:30:00')

function task(id: string, reminder: string | null, extra: Partial<Task> = {}): Task {
  return {
    ...newLocalTask('L1', `Task ${id}`),
    id,
    listId: 'L1',
    isReminderOn: reminder !== null,
    reminderAt: reminder ? at(reminder).toISOString() : null,
    ...extra,
  }
}

describe('dueReminders', () => {
  it('lists open tasks whose reminder has passed, newest first', () => {
    const tasks = [
      task('a', '2026-11-10T09:00:00'),
      task('b', '2026-11-10T14:00:00'),
      task('c', '2026-11-10T18:00:00'), // still in the future
    ]
    expect(dueReminders(tasks, {}, NOW).map((t) => t.id)).toEqual(['b', 'a'])
  })

  it('skips completed tasks, switched-off reminders and tasks without a reminder', () => {
    const tasks = [
      task('done', '2026-11-10T09:00:00', { status: 'completed', completed: 1 }),
      task('off', '2026-11-10T09:00:00', { isReminderOn: false }),
      task('none', null),
    ]
    expect(dueReminders(tasks, {}, NOW)).toEqual([])
  })

  it('skips reminders dismissed for that exact time, but shows the task again once it is rescheduled', () => {
    const t = task('a', '2026-11-10T09:00:00')
    expect(dueReminders([t], { a: t.reminderAt! }, NOW)).toEqual([])
    const moved = task('a', '2026-11-10T10:00:00')
    expect(dueReminders([moved], { a: t.reminderAt! }, NOW)).toHaveLength(1)
  })

  it('forgets reminders from more than a week ago', () => {
    const tasks = [task('old', '2026-11-02T09:00:00'), task('recent', '2026-11-04T09:00:00')]
    expect(dueReminders(tasks, {}, NOW).map((t) => t.id)).toEqual(['recent'])
  })
})

describe('pruneDismissed', () => {
  it('drops entries for tasks that are gone or whose reminder moved', () => {
    const a = task('a', '2026-11-10T09:00:00')
    const b = task('b', '2026-11-10T10:00:00')
    const dismissed = { a: a.reminderAt!, b: 'stale', gone: a.reminderAt! }
    expect(pruneDismissed(dismissed, [a, b])).toEqual({ a: a.reminderAt! })
  })

  it('returns the same object when nothing changes', () => {
    const a = task('a', '2026-11-10T09:00:00')
    const dismissed = { a: a.reminderAt! }
    expect(pruneDismissed(dismissed, [a])).toBe(dismissed)
  })
})

describe('snoozeOptions', () => {
  const options = (now = NOW, settings = DEFAULT_DATE_SETTINGS) => snoozeOptions(settings, now, TZ)

  it('offers 10 minutes and 1 hour from now', () => {
    const [ten, hour] = options()
    expect(ten.at.toISOString()).toBe(new Date(NOW.getTime() + 10 * 60_000).toISOString())
    expect(hour.at.toISOString()).toBe(new Date(NOW.getTime() + 60 * 60_000).toISOString())
  })

  it('offers the next reminder time of today and the first one tomorrow', () => {
    const options2 = options()
    const later = options2.find((o) => o.id === 'later')
    const tomorrow = options2.find((o) => o.id === 'tomorrow')
    expect(later?.at.toISOString()).toBe(at('2026-11-10T18:00:00').toISOString())
    expect(later?.time).toBe('18:00')
    expect(tomorrow?.at.toISOString()).toBe(at('2026-11-11T09:00:00').toISOString())
    expect(tomorrow?.time).toBe('09:00')
  })

  it('leaves out "later today" once every reminder time of today has passed', () => {
    const late = at('2026-11-10T20:00:00')
    expect(options(late).map((o) => o.id)).toEqual(['10m', '1h', 'tomorrow'])
  })

  it('follows the user\'s own reminder times and falls back to 09:00 without any', () => {
    const custom = { ...DEFAULT_DATE_SETTINGS, reminderTimes: ['07:30', '16:00'] }
    const o = options(NOW, custom)
    expect(o.find((x) => x.id === 'later')?.time).toBe('16:00')
    expect(o.find((x) => x.id === 'tomorrow')?.time).toBe('07:30')
    const none = { ...DEFAULT_DATE_SETTINGS, reminderTimes: [] }
    expect(options(NOW, none).find((x) => x.id === 'tomorrow')?.time).toBe('09:00')
  })
})

describe('formatAgo', () => {
  const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString()
  it('says how long ago a reminder came due', () => {
    expect(formatAgo(ago(0), NOW)).toBe('just now')
    expect(formatAgo(ago(4), NOW)).toBe('4 min ago')
    expect(formatAgo(ago(60), NOW)).toBe('1 hour ago')
    expect(formatAgo(ago(190), NOW)).toBe('3 hours ago')
    expect(formatAgo(ago(60 * 30), NOW)).toBe('1 day ago')
    expect(formatAgo(ago(60 * 24 * 3), NOW)).toBe('3 days ago')
  })
})

describe('describeSnooze', () => {
  it('says the time for today and adds the day otherwise', () => {
    expect(describeSnooze(at('2026-11-10T18:00:00'), '2026-11-10', TZ, 'en-GB')).toBe('Snoozed until 18:00')
    expect(describeSnooze(at('2026-11-11T09:00:00'), '2026-11-10', TZ, 'en-GB')).toBe('Snoozed until 9:00, Tomorrow')
  })
})
