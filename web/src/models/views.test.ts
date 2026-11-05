import { describe, expect, it } from 'vitest'
import { newLocalTask, type Task } from './todo'
import {
  buildRecurrence,
  describeRecurrence,
  formatDate,
  nextMonday,
  recurrencePreset,
} from './presets'
import { groupPlanned, orderLists, sortTasks, splitListEmoji, tasksForView } from './views'

const task = (title: string, extra: Partial<Task> = {}): Task => ({
  ...newLocalTask('L1', title),
  ...extra,
})

describe('smart lists', () => {
  const tasks = [
    task('a', { important: 1, importance: 'high' }),
    task('b', { dueDate: '2026-11-04' }),
    task('c', { completed: 1, status: 'completed', important: 1 }),
    task('d', { isReminderOn: true, reminderAt: '2026-11-06T08:00:00.000Z', listId: 'L2' }),
    task('e', { body: 'remember the Crème brûlée' }),
  ]

  it('filters important, planned, all, completed and lists', () => {
    expect(tasksForView({ kind: 'smart', id: 'important' }, tasks).open.map((t) => t.title)).toEqual(['a'])
    expect(tasksForView({ kind: 'smart', id: 'planned' }, tasks).open.map((t) => t.title)).toEqual(['b', 'd'])
    const all = tasksForView({ kind: 'smart', id: 'all' }, tasks)
    expect(all.open).toHaveLength(4)
    expect(all.completed.map((t) => t.title)).toEqual(['c'])
    expect(tasksForView({ kind: 'smart', id: 'completed' }, tasks).completed.map((t) => t.title)).toEqual(['c'])
    expect(tasksForView({ kind: 'list', listId: 'L2' }, tasks).open.map((t) => t.title)).toEqual(['d'])
  })

  it('searches title, notes and steps, ignoring case and accents', () => {
    expect(tasksForView({ kind: 'search', query: 'creme BRULEE' }, tasks).open.map((t) => t.title)).toEqual(['e'])
  })

  it('groups planned tasks relative to today (Wed 2026-11-04)', () => {
    const groups = groupPlanned(
      [
        task('overdue', { dueDate: '2026-11-01' }),
        task('today', { dueDate: '2026-11-04' }),
        task('tomorrow', { dueDate: '2026-11-05' }),
        task('sunday', { dueDate: '2026-11-08' }),
        task('next monday', { dueDate: '2026-11-09' }),
      ],
      '2026-11-04',
    )
    expect(groups.map((g) => [g.group, g.tasks.map((t) => t.title)])).toEqual([
      ['earlier', ['overdue']],
      ['today', ['today']],
      ['tomorrow', ['tomorrow']],
      ['thisWeek', ['sunday']],
      ['later', ['next monday']],
    ])
  })

  it('sorts, keeping undated tasks last for due date sorting', () => {
    const list = [task('B', { dueDate: '2026-12-01' }), task('a'), task('C', { dueDate: '2026-11-01' })]
    expect(sortTasks(list, { key: 'dueDate', dir: 'asc' }).map((t) => t.title)).toEqual(['C', 'B', 'a'])
    expect(sortTasks(list, { key: 'title', dir: 'asc' }).map((t) => t.title)).toEqual(['a', 'B', 'C'])
  })

  it('orders lists with Tasks first', () => {
    const base = { isOwner: true, isShared: false }
    const lists = orderLists([
      { id: '2', displayName: 'Z', wellknownListName: 'none', sortIndex: 0, ...base },
      { id: '1', displayName: 'Tasks', wellknownListName: 'defaultList', sortIndex: 5, ...base },
    ])
    expect(lists.map((l) => l.id)).toEqual(['1', '2'])
  })

  it('splits a leading emoji from list names', () => {
    expect(splitListEmoji('🛒 Groceries')).toEqual({ emoji: '🛒', label: 'Groceries' })
    expect(splitListEmoji('👨‍👩‍👧 Family')).toEqual({ emoji: '👨‍👩‍👧', label: 'Family' })
    expect(splitListEmoji('Work')).toEqual({ emoji: null, label: 'Work' })
  })
})

describe('presets', () => {
  it('finds next Monday', () => {
    expect(nextMonday('2026-11-04')).toBe('2026-11-09')
    expect(nextMonday('2026-11-09')).toBe('2026-11-16')
  })

  it('builds and describes recurrences', () => {
    const weekdays = buildRecurrence('weekdays', '2026-11-04')
    expect(weekdays.pattern?.daysOfWeek).toEqual(['monday', 'tuesday', 'wednesday', 'thursday', 'friday'])
    expect(describeRecurrence(weekdays)).toBe('Weekdays')
    expect(recurrencePreset(weekdays)).toBe('weekdays')

    const weekly = buildRecurrence('weekly', '2026-11-04')
    expect(weekly.pattern?.daysOfWeek).toEqual(['wednesday'])
    expect(describeRecurrence(weekly)).toBe('Weekly')

    const monthly = buildRecurrence('monthly', '2026-11-04')
    expect(monthly.pattern).toMatchObject({ type: 'absoluteMonthly', dayOfMonth: 4 })
    expect(monthly.range).toEqual({ type: 'noEnd', startDate: '2026-11-04' })

    const custom = buildRecurrence({ interval: 2, unit: 'week', days: ['monday', 'thursday'] }, '2026-11-04')
    expect(describeRecurrence(custom)).toBe('Every 2 weeks on Mon, Thu')
    expect(recurrencePreset(custom)).toBe('custom')
    expect(describeRecurrence(buildRecurrence({ interval: 3, unit: 'month' }, '2026-11-04'))).toBe('Every 3 months')
  })

  it('formats relative dates', () => {
    expect(formatDate('2026-11-04', '2026-11-04')).toBe('Today')
    expect(formatDate('2026-11-05', '2026-11-04')).toBe('Tomorrow')
    expect(formatDate('2026-11-11', '2026-11-04', 'en-US')).toBe('Wed, Nov 11')
    expect(formatDate('2027-01-11', '2026-11-04', 'en-US')).toBe('Mon, Jan 11, 2027')
  })
})
