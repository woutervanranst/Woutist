import { describe, expect, it } from 'vitest'
import { applyChanges, fromGraphList, fromGraphTask, newLocalTask, toGraphCreate, toGraphPatch } from './todo'

describe('Graph mappers', () => {
  it('maps a list', () => {
    expect(
      fromGraphList({ id: 'L1', displayName: 'Groceries 🛒', wellknownListName: 'none', isOwner: true, isShared: true }),
    ).toEqual({ id: 'L1', displayName: 'Groceries 🛒', wellknownListName: 'none', isOwner: true, isShared: true, sortIndex: 0 })
  })

  it('maps a fully populated task', () => {
    const t = fromGraphTask(
      {
        id: 'T1',
        title: 'Pay rent',
        status: 'notStarted',
        importance: 'high',
        body: { content: 'IBAN in mail', contentType: 'text' },
        dueDateTime: { dateTime: '2026-11-05T00:00:00.0000000', timeZone: 'Europe/Brussels' },
        reminderDateTime: { dateTime: '2026-11-05T09:00:00.0000000', timeZone: 'Europe/Brussels' },
        isReminderOn: true,
        categories: ['Red category'],
        hasAttachments: false,
        createdDateTime: '2026-11-01T10:00:00Z',
        lastModifiedDateTime: '2026-11-02T10:00:00Z',
        recurrence: {
          pattern: { type: 'absoluteMonthly', interval: 1, dayOfMonth: 5 },
          range: { type: 'noEnd', startDate: '2026-11-05' },
        },
        checklistItems: [
          { id: 'S1', displayName: 'Log in', isChecked: true, createdDateTime: '2026-11-01T10:00:00Z', checkedDateTime: '2026-11-01T11:00:00Z' },
        ],
        linkedResources: [{ id: 'R1', webUrl: 'https://example.com', applicationName: 'Web', displayName: 'Bank' }],
      },
      'L1',
    )
    expect(t).toMatchObject({
      id: 'T1',
      listId: 'L1',
      title: 'Pay rent',
      important: 1,
      completed: 0,
      body: 'IBAN in mail',
      bodyHtml: null,
      dueDate: '2026-11-05',
      reminderAt: '2026-11-05T08:00:00.000Z',
      isReminderOn: true,
      categories: ['Red category'],
    })
    expect(t.steps).toEqual([
      { id: 'S1', displayName: 'Log in', isChecked: true, createdDateTime: '2026-11-01T10:00:00Z', checkedDateTime: '2026-11-01T11:00:00Z' },
    ])
    expect(t.linkedResources[0]).toMatchObject({ webUrl: 'https://example.com', applicationName: 'Web' })
    expect(t.recurrence?.pattern?.type).toBe('absoluteMonthly')
  })

  it('converts HTML bodies (flagged emails) to text but keeps the original', () => {
    const t = fromGraphTask({ id: 'T2', body: { content: '<p>Hello <b>you</b></p>', contentType: 'html' } }, 'L1')
    expect(t.body).toBe('Hello you')
    expect(t.bodyHtml).toBe('<p>Hello <b>you</b></p>')
  })

  it('builds a field-level PATCH with only the changed fields', () => {
    expect(toGraphPatch({ importance: 'high' })).toEqual({ importance: 'high' })
    expect(toGraphPatch({ dueDate: '2026-11-05', reminderAt: '2026-11-05T08:00:00.000Z', isReminderOn: true })).toEqual({
      dueDateTime: { dateTime: '2026-11-05T00:00:00', timeZone: 'Europe/Brussels' },
      reminderDateTime: { dateTime: '2026-11-05T09:00:00', timeZone: 'Europe/Brussels' },
      isReminderOn: true,
    })
    expect(toGraphPatch({ dueDate: null, body: 'x' })).toEqual({
      dueDateTime: null,
      body: { content: 'x', contentType: 'text' },
    })
  })

  it('applies changes optimistically and keeps query flags in sync', () => {
    const t = newLocalTask('L1', 'Buy milk')
    expect(t.id.startsWith('tmp_')).toBe(true)
    const done = applyChanges(t, { status: 'completed', importance: 'high' })
    expect(done.completed).toBe(1)
    expect(done.important).toBe(1)
    expect(done.completedDate).not.toBeNull()
    const reopened = applyChanges(done, { status: 'notStarted' })
    expect(reopened.completed).toBe(0)
    expect(reopened.completedDate).toBeNull()
  })

  it('creates a minimal Graph create body', () => {
    const t = newLocalTask('L1', 'Call mom', { importance: 'high', dueDate: '2026-11-06' })
    expect(toGraphCreate(t)).toEqual({
      title: 'Call mom',
      importance: 'high',
      dueDateTime: { dateTime: '2026-11-06T00:00:00', timeZone: 'Europe/Brussels' },
    })
  })
})
