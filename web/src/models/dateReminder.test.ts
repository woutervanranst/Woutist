import { describe, expect, it } from 'vitest'
import {
  type DateFields,
  changesForDate,
  changesForTime,
  describeDateChange,
  quickDateHint,
  reminderLabel,
  reminderWall,
  restoreChanges,
} from './dateReminder'
import { DEFAULT_DATE_SETTINGS } from './quickDates'

const TZ = 'Europe/Brussels'
const task = (extra: Partial<DateFields> = {}): DateFields => ({
  dueDate: null,
  reminderAt: null,
  isReminderOn: false,
  recurrence: null,
  ...extra,
})
// 2026-11-05 09:00 in Brussels (CET, UTC+1)
const NINE = '2026-11-05T08:00:00.000Z'

describe('changesForDate', () => {
  it('sets just the date when there is no reminder', () => {
    expect(changesForDate(task(), '2026-11-06', DEFAULT_DATE_SETTINGS, TZ)).toEqual({ dueDate: '2026-11-06' })
  })

  it('keeps the reminder hour on the new date', () => {
    const t = task({ dueDate: '2026-11-05', reminderAt: NINE, isReminderOn: true })
    expect(changesForDate(t, '2026-11-09', DEFAULT_DATE_SETTINGS, TZ)).toEqual({
      dueDate: '2026-11-09',
      reminderAt: '2026-11-09T08:00:00.000Z',
      isReminderOn: true,
    })
  })

  it('keeps the wall-clock hour across a DST change', () => {
    // 2026-10-20 09:00 CEST (UTC+2) → 2026-11-02 09:00 CET (UTC+1)
    const t = task({ dueDate: '2026-10-20', reminderAt: '2026-10-20T07:00:00.000Z', isReminderOn: true })
    expect(changesForDate(t, '2026-11-02', DEFAULT_DATE_SETTINGS, TZ).reminderAt).toBe('2026-11-02T08:00:00.000Z')
  })

  it('removes the reminder with the date', () => {
    const t = task({ dueDate: '2026-11-05', reminderAt: NINE, isReminderOn: true })
    expect(changesForDate(t, null, DEFAULT_DATE_SETTINGS, TZ)).toEqual({
      dueDate: null,
      reminderAt: null,
      isReminderOn: false,
    })
  })

  it('preselects the first reminder time when asked to, unless it has passed', () => {
    const settings = { ...DEFAULT_DATE_SETTINGS, newReminder: 'first' as const }
    const morning = new Date('2026-11-05T06:00:00Z')
    const evening = new Date('2026-11-05T17:00:00Z')
    expect(changesForDate(task(), '2026-11-05', settings, TZ, morning)).toEqual({
      dueDate: '2026-11-05',
      reminderAt: NINE,
      isReminderOn: true,
    })
    expect(changesForDate(task(), '2026-11-05', settings, TZ, evening)).toEqual({ dueDate: '2026-11-05' })
    expect(changesForDate(task(), '2026-11-05', { ...settings, reminderTimes: [] }, TZ, morning)).toEqual({
      dueDate: '2026-11-05',
    })
  })
})

describe('changesForTime', () => {
  it('sets the reminder on the due date', () => {
    const t = task({ dueDate: '2026-11-06' })
    expect(changesForTime(t, '13:00', TZ, '2026-11-05')).toEqual({
      reminderAt: '2026-11-06T12:00:00.000Z',
      isReminderOn: true,
    })
  })

  it('dates a task without a date today', () => {
    expect(changesForTime(task(), '09:00', TZ, '2026-11-05')).toEqual({
      dueDate: '2026-11-05',
      reminderAt: NINE,
      isReminderOn: true,
    })
  })

  it('removes the reminder', () => {
    expect(changesForTime(task({ reminderAt: NINE, isReminderOn: true }), null, TZ)).toEqual({
      reminderAt: null,
      isReminderOn: false,
    })
  })
})

describe('restoreChanges', () => {
  it('returns only what differs', () => {
    const before = task({ dueDate: '2026-11-05', reminderAt: NINE, isReminderOn: true })
    const after = task({ dueDate: '2026-11-06', reminderAt: NINE, isReminderOn: true })
    expect(restoreChanges(after, before)).toEqual({ dueDate: '2026-11-05' })
    expect(restoreChanges(before, before)).toEqual({})
  })

  it('restores a repeat removed with the date', () => {
    const recurrence = { pattern: { type: 'daily' as const, interval: 1 }, range: { type: 'noEnd' as const, startDate: '2026-11-05' } }
    const before = task({ dueDate: '2026-11-05', recurrence })
    expect(restoreChanges(task(), before)).toEqual({ dueDate: '2026-11-05', recurrence })
  })
})

describe('display', () => {
  it('reads the reminder in the zone', () => {
    expect(reminderWall({ reminderAt: NINE, isReminderOn: true }, TZ)).toEqual({ date: '2026-11-05', time: '09:00' })
    expect(reminderWall({ reminderAt: NINE, isReminderOn: false }, TZ)).toBeNull()
  })

  it('describes the reminder relative to the due date', () => {
    const t = task({ dueDate: '2026-11-05', reminderAt: NINE, isReminderOn: true })
    expect(reminderLabel(t, '2026-11-05', TZ, 'en-US')).toBe('9:00 AM')
    expect(reminderLabel({ ...t, dueDate: '2026-11-06' }, '2026-11-05', TZ, 'en-US')).toBe('9:00 AM, Today')
    expect(reminderLabel(task(), '2026-11-05', TZ)).toBeNull()
  })

  it('describes a change for the toast', () => {
    const t = task({ dueDate: '2026-11-06', reminderAt: '2026-11-06T08:00:00.000Z', isReminderOn: true })
    expect(describeDateChange(t, '2026-11-05', TZ, 'en-US')).toBe('Moved to Tomorrow · 9:00 AM')
    expect(describeDateChange(task(), '2026-11-05', TZ)).toBe('Date removed')
  })

  it('hints the weekday within a week, else the date', () => {
    expect(quickDateHint('2026-11-07', '2026-11-05', 'en-US')).toBe('Sat')
    expect(quickDateHint('2026-11-12', '2026-11-05', 'en-US')).toBe('Thu, Nov 12')
  })
})
