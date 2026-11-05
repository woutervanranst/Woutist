import type { PatternedRecurrence } from './todo'
import { addDays, dayOfWeek, todayLocal } from './time'

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const
export type DayName = (typeof DAY_NAMES)[number]
const SHORT_DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Next Monday strictly after `date`. */
export function nextMonday(date: string): string {
  const dow = dayOfWeek(date)
  const delta = ((8 - dow) % 7) || 7
  return addDays(date, delta)
}

// ---------- recurrence ----------

export type RepeatPreset = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly'
export type RepeatUnit = 'day' | 'week' | 'month' | 'year'

export interface CustomRepeat {
  interval: number
  unit: RepeatUnit
  /** Only for weekly repeats. */
  days?: DayName[]
}

/** Build a Graph recurrence anchored on the task's due date (Microsoft To Do requires one). */
export function buildRecurrence(preset: RepeatPreset | CustomRepeat, dueDate: string): PatternedRecurrence {
  const custom: CustomRepeat =
    typeof preset === 'string'
      ? {
          daily: { interval: 1, unit: 'day' as const },
          weekdays: {
            interval: 1,
            unit: 'week' as const,
            days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as DayName[],
          },
          weekly: { interval: 1, unit: 'week' as const },
          monthly: { interval: 1, unit: 'month' as const },
          yearly: { interval: 1, unit: 'year' as const },
        }[preset]
      : preset
  const interval = Math.max(1, Math.floor(custom.interval))
  const [, month, day] = dueDate.split('-').map(Number)
  const range = { type: 'noEnd' as const, startDate: dueDate }
  switch (custom.unit) {
    case 'day':
      return { pattern: { type: 'daily', interval }, range }
    case 'week':
      return {
        pattern: {
          type: 'weekly',
          interval,
          daysOfWeek: custom.days?.length ? custom.days : [DAY_NAMES[dayOfWeek(dueDate)]],
          firstDayOfWeek: 'sunday',
        },
        range,
      }
    case 'month':
      return { pattern: { type: 'absoluteMonthly', interval, dayOfMonth: day }, range }
    case 'year':
      return { pattern: { type: 'absoluteYearly', interval, dayOfMonth: day, month }, range }
  }
}

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']

/** Human-readable description of a Graph recurrence ("Weekdays", "Every 2 weeks on Mon, Thu"). */
export function describeRecurrence(rec: PatternedRecurrence | null | undefined): string {
  const p = rec?.pattern
  if (!p?.type) return ''
  const n = p.interval ?? 1
  const every = (unit: string) => (n === 1 ? unit.charAt(0).toUpperCase() + unit.slice(1) + 'ly' : `Every ${n} ${unit}s`)
  switch (p.type) {
    case 'daily':
      return n === 1 ? 'Daily' : `Every ${n} days`
    case 'weekly': {
      const days = (p.daysOfWeek ?? []) as string[]
      if (n === 1 && days.length === 5 && WEEKDAYS.every((d) => days.includes(d))) return 'Weekdays'
      const names = DAY_NAMES.filter((d) => days.includes(d)).map((d) => SHORT_DAY[DAY_NAMES.indexOf(d)])
      const base = n === 1 ? 'Weekly' : `Every ${n} weeks`
      return names.length > 1 ? `${base} on ${names.join(', ')}` : base
    }
    case 'absoluteMonthly':
    case 'relativeMonthly':
      return n === 1 ? 'Monthly' : every('month')
    case 'absoluteYearly':
    case 'relativeYearly':
      return n === 1 ? 'Yearly' : `Every ${n} years`
    default:
      return 'Repeats'
  }
}

/** Which simple preset (if any) a recurrence corresponds to, for checkmarks in menus. */
export function recurrencePreset(rec: PatternedRecurrence | null | undefined): RepeatPreset | 'custom' | null {
  const p = rec?.pattern
  if (!p?.type) return null
  const n = p.interval ?? 1
  if (n !== 1) return 'custom'
  if (p.type === 'daily') return 'daily'
  if (p.type === 'weekly') {
    const days = (p.daysOfWeek ?? []) as string[]
    if (days.length === 5 && WEEKDAYS.every((d) => days.includes(d))) return 'weekdays'
    return days.length <= 1 ? 'weekly' : 'custom'
  }
  if (p.type === 'absoluteMonthly') return 'monthly'
  if (p.type === 'absoluteYearly') return 'yearly'
  return 'custom'
}

// ---------- display formatting ----------

/** "Today", "Tomorrow", "Yesterday", "Wed, Nov 11" or "Wed, Nov 11, 2027". */
export function formatDate(date: string, today: string = todayLocal(), locale?: string): string {
  if (date === today) return 'Today'
  if (date === addDays(today, 1)) return 'Tomorrow'
  if (date === addDays(today, -1)) return 'Yesterday'
  const [y, m, d] = date.split('-').map(Number)
  const sameYear = y === Number(today.slice(0, 4))
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)))
}

export function formatTime(instant: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(new Date(instant))
}

/** "Remind me at 09:00 · Tomorrow". */
export function formatReminder(instant: string, today: string = todayLocal(), locale?: string): string {
  const date = todayLocal(new Date(instant))
  return `${formatTime(instant, locale)}, ${formatDate(date, today, locale)}`
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
