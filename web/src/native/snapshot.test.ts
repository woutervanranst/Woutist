import { describe, expect, it } from 'vitest'
import { DEFAULT_DATE_SETTINGS, normalizeDateSettings, quickDateOptions } from '../models/quickDates'
import { newLocalTask, type Task, type TodoList } from '../models/todo'
import {
  buildSnapshot,
  remindersFromSnapshot,
  widgetDoneTasks,
  widgetTasks,
  type NativeSnapshot,
  type WidgetSource,
} from './snapshot'
import fixtureInput from './__fixtures__/snapshot-input.json'
import expected from './__fixtures__/reminders-expected.json'
import widgetExpected from './__fixtures__/widget-expected.json'
import quickDatesExpected from './__fixtures__/quickdates-expected.json'

const list = (id: string, displayName: string, sortIndex: number): TodoList => ({
  id,
  displayName,
  wellknownListName: 'none',
  isOwner: true,
  isShared: false,
  sortIndex,
})
const task = (id: string, listId: string, extra: Partial<Task> = {}): Task => ({ ...newLocalTask(listId, id), id, ...extra })
const now = new Date('2026-11-05T08:00:00Z')
const build = (lists: TodoList[], tasks: Task[]) =>
  buildSnapshot({ accountKey: 'oid.tid', lists, tasks, sort: {}, dates: DEFAULT_DATE_SETTINGS, now, timeZone: 'Europe/Brussels' })

describe('buildSnapshot', () => {
  it('excludesCompletedAndTempTasks', () => {
    const s = build(
      [list('L1', 'Tasks', 0), list('tmp_L2', 'New list', 1)],
      [
        task('open', 'L1'),
        task('done', 'L1', { status: 'completed', completed: 1 }),
        task('tmp_new', 'L1'),
        task('in-temp-list', 'tmp_L2'),
      ],
    )
    expect(s.tasks.map((t) => t.id)).toEqual(['open'])
    expect(s.lists.map((l) => l.id)).toEqual(['L1'])
    expect(s).toMatchObject({ version: 1, accountKey: 'oid.tid', generatedAt: now.toISOString(), timeZone: 'Europe/Brussels' })
  })

  it('reminderAtOnlyWhenOn', () => {
    const s = build(
      [list('L1', 'Tasks', 0)],
      [
        task('on', 'L1', { isReminderOn: true, reminderAt: '2026-11-05T09:00:00Z' }),
        task('off', 'L1', { isReminderOn: false, reminderAt: '2026-11-05T09:00:00Z' }),
      ],
    )
    expect(s.tasks.find((t) => t.id === 'on')?.reminderAt).toBe('2026-11-05T09:00:00.000Z')
    expect(s.tasks.find((t) => t.id === 'off')?.reminderAt).toBeNull()
  })

  it('completedTodayHoldsOnlyTodaysCompletedTasks', () => {
    const done = { status: 'completed', completed: 1 } as const
    const s = build(
      [list('L1', 'Tasks', 0)],
      [
        task('open', 'L1'),
        task('today', 'L1', { ...done, completedDate: '2026-11-05' }),
        task('yesterday', 'L1', { ...done, completedDate: '2026-11-04' }),
        task('tmp_today', 'L1', { ...done, completedDate: '2026-11-05' }),
      ],
    )
    expect(s.tasks.map((t) => t.id)).toEqual(['open'])
    expect(s.completedToday.map((t) => [t.id, t.completedDate])).toEqual([['today', '2026-11-05']])
  })

  it('completedTodayUsesTheSnapshotZone', () => {
    // 23:30 UTC on the 4th is already the 5th in Brussels.
    const s = buildSnapshot({
      accountKey: 'oid.tid',
      lists: [list('L1', 'Tasks', 0)],
      tasks: [task('done', 'L1', { status: 'completed', completed: 1, completedDate: '2026-11-05' })],
      sort: {},
      dates: DEFAULT_DATE_SETTINGS,
      now: new Date('2026-11-04T23:30:00Z'),
      timeZone: 'Europe/Brussels',
    })
    expect(s.completedToday.map((t) => t.id)).toEqual(['done'])
  })
})

describe('buildSnapshot outbox', () => {
  it('flagsUnsentChanges', () => {
    const base = { accountKey: 'oid.tid', lists: [], tasks: [], sort: {}, dates: DEFAULT_DATE_SETTINGS, now, timeZone: 'Europe/Brussels' }
    expect(buildSnapshot(base).outboxPending).toBe(false)
    expect(buildSnapshot({ ...base, outboxPending: true }).outboxPending).toBe(true)
  })
})

describe('remindersFromSnapshot', () => {
  it('remindersMatchFixture', () => {
    expect(remindersFromSnapshot(fixtureInput as unknown as NativeSnapshot, now)).toEqual(expected)
  })
})

describe('widgetTasks', () => {
  const source = (key: string): WidgetSource =>
    key.startsWith('list:')
      ? { kind: 'list', listId: key.slice(5) }
      : { kind: 'smart', id: key.slice(6) as 'today' | 'important' | 'planned' }
  // The fixture's "today", in Brussels (the snapshot was generated on 2026-11-05).
  const today = '2026-11-05'
  const snapshot = fixtureInput as unknown as NativeSnapshot

  it('widgetTasksMatchFixture', () => {
    for (const [key, ids] of Object.entries(widgetExpected)) {
      // "done:<key>" lists the completed rows shown under the open ones.
      const tasks = key.startsWith('done:')
        ? widgetDoneTasks(snapshot, source(key.slice(5)), today)
        : widgetTasks(snapshot, source(key), today)
      expect(tasks.map((t) => t.id), key).toEqual(ids)
    }
  })

  it('doneTasksFromAnOldSnapshotAreHidden', () => {
    expect(widgetDoneTasks(snapshot, { kind: 'smart', id: 'today' }, '2026-11-06')).toEqual([])
  })
})

describe('quick dates', () => {
  // The phone's quick-add dialog computes the same quick dates (quickadd/QuickDates.kt), checked against the same fixture.
  it('quickDatesMatchFixture', () => {
    const settings = normalizeDateSettings(fixtureInput.dates)
    for (const [today, rows] of Object.entries(quickDatesExpected)) {
      expect(quickDateOptions(settings, today).map((o) => [o.id, o.label, o.short, o.value]), today).toEqual(rows)
    }
  })

  it('travelsInTheSnapshot', () => {
    expect(build([], []).dates).toEqual(DEFAULT_DATE_SETTINGS)
  })
})
