import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DATE_SETTINGS,
  MAX_QUICK_DATES,
  addCustomQuickDate,
  addReminderTime,
  moveQuickDate,
  nextWeekday,
  normalizeDateSettings,
  quickDateOptions,
  removeQuickDate,
  removeReminderTime,
  thisWeekend,
  toggleQuickDate,
} from './quickDates'

// 2026-11-05 is a Thursday.
const THU = '2026-11-05'

describe('quick dates', () => {
  it('computes the built-in dates', () => {
    const options = quickDateOptions(DEFAULT_DATE_SETTINGS, THU)
    expect(options.map((o) => [o.id, o.value])).toEqual([
      ['today', '2026-11-05'],
      ['tomorrow', '2026-11-06'],
      ['dayAfter', '2026-11-07'],
      ['weekend', '2026-11-07'],
      ['nextWeek', '2026-11-09'],
      ['inWeek', '2026-11-12'],
    ])
  })

  it('takes this weekend to mean the coming Saturday', () => {
    expect(thisWeekend('2026-11-05')).toBe('2026-11-07') // Thu
    expect(thisWeekend('2026-11-07')).toBe('2026-11-07') // Sat
    expect(thisWeekend('2026-11-08')).toBe('2026-11-14') // Sun
  })

  it('finds the next weekday strictly after the date', () => {
    expect(nextWeekday(THU, 3)).toBe('2026-11-11') // Wed
    expect(nextWeekday(THU, 4)).toBe('2026-11-12') // Thu → a week later
  })

  it('leaves out disabled entries and keeps the order', () => {
    let s = toggleQuickDate(DEFAULT_DATE_SETTINGS, 'dayAfter')
    s = moveQuickDate(s, 'inWeek', -1)
    expect(quickDateOptions(s, THU).map((o) => o.id)).toEqual(['today', 'tomorrow', 'weekend', 'inWeek', 'nextWeek'])
  })

  it('adds custom quick dates, once each', () => {
    let s = addCustomQuickDate(DEFAULT_DATE_SETTINGS, { kind: 'days', n: 3 }, 'c1')
    s = addCustomQuickDate(s, { kind: 'weeks', n: 2 }, 'c2')
    s = addCustomQuickDate(s, { kind: 'weekday', weekday: 3 }, 'c3')
    s = addCustomQuickDate(s, { kind: 'days', n: 3 }, 'c4')
    const custom = quickDateOptions(s, THU).slice(6)
    expect(custom.map((o) => [o.label, o.rule, o.value])).toEqual([
      ['In 3 days', '+3 days', '2026-11-08'],
      ['In 2 weeks', '+14 days', '2026-11-19'],
      ['Next Wednesday', 'Wednesday', '2026-11-11'],
    ])
  })

  it('caps the number of quick dates', () => {
    let s = DEFAULT_DATE_SETTINGS
    for (let n = 1; n <= 20; n++) s = addCustomQuickDate(s, { kind: 'days', n }, `c${n}`)
    expect(s.quickDates).toHaveLength(MAX_QUICK_DATES)
  })

  it('removes only custom quick dates', () => {
    const s = addCustomQuickDate(DEFAULT_DATE_SETTINGS, { kind: 'days', n: 3 }, 'c1')
    expect(removeQuickDate(s, 'c1').quickDates.map((e) => e.id)).not.toContain('c1')
    expect(removeQuickDate(s, 'today')).toBe(s)
  })

  it('keeps reminder times valid, unique and sorted', () => {
    let s = addReminderTime(DEFAULT_DATE_SETTINGS, '07:30')
    s = addReminderTime(s, '13:00')
    s = addReminderTime(s, '25:00')
    expect(s.reminderTimes).toEqual(['07:30', '09:00', '13:00', '18:00'])
    expect(removeReminderTime(s, '09:00').reminderTimes).toEqual(['07:30', '13:00', '18:00'])
  })
})

describe('normalizeDateSettings', () => {
  it('falls back to defaults for junk', () => {
    expect(normalizeDateSettings(null)).toEqual(DEFAULT_DATE_SETTINGS)
    expect(normalizeDateSettings('x')).toEqual(DEFAULT_DATE_SETTINGS)
  })

  it('drops invalid entries and re-adds missing built-ins (turned off)', () => {
    const s = normalizeDateSettings({
      quickDates: [
        { id: 'tomorrow', on: true },
        { id: 'c1', on: true, custom: { kind: 'days', n: 4 } },
        { id: 'c2', on: true, custom: { kind: 'days', n: 0 } },
        { id: 'c3', on: true, custom: { kind: 'fortnight' } },
        { id: 'tomorrow', on: false },
        { id: 'unknownBuiltIn', on: true },
      ],
      reminderTimes: ['18:00', 'noon', '08:00', '08:00'],
      newReminder: 'first',
    })
    expect(s.quickDates.map((e) => [e.id, e.on])).toEqual([
      ['tomorrow', true],
      ['c1', true],
      ['today', false],
      ['dayAfter', false],
      ['weekend', false],
      ['nextWeek', false],
      ['inWeek', false],
    ])
    expect(s.reminderTimes).toEqual(['08:00', '18:00'])
    expect(s.newReminder).toBe('first')
  })
})
