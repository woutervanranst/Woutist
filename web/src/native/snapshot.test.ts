import { describe, expect, it } from 'vitest'
import { newLocalTask, type Task, type TodoList } from '../models/todo'
import { buildSnapshot, remindersFromSnapshot, type NativeSnapshot } from './snapshot'
import fixtureInput from './__fixtures__/snapshot-input.json'
import expected from './__fixtures__/reminders-expected.json'

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
  buildSnapshot({ accountKey: 'oid.tid', lists, tasks, sort: {}, now, timeZone: 'Europe/Brussels' })

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
})

describe('remindersFromSnapshot', () => {
  it('remindersMatchFixture', () => {
    expect(remindersFromSnapshot(fixtureInput as NativeSnapshot, now)).toEqual(expected)
  })
})
