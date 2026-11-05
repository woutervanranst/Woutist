import { nextMonday } from './presets'
import { addDays, dayOfWeek } from './time'

/**
 * Quick dates and reminder times offered by the date + reminder picker. The user configures them in
 * Settings; they're saved in their Microsoft account (see services/settingsSync.ts).
 */

export type BuiltInQuickDateId = 'today' | 'tomorrow' | 'dayAfter' | 'weekend' | 'nextWeek' | 'inWeek'

export type CustomQuickDate =
  | { kind: 'days'; n: number }
  | { kind: 'weeks'; n: number }
  /** 0 = Sunday … 6 = Saturday. */
  | { kind: 'weekday'; weekday: number }

export interface QuickDateEntry {
  id: string
  on: boolean
  /** Only on entries the user added; built-ins are identified by their id. */
  custom?: CustomQuickDate
}

/** Which icon and color a quick date is shown with. */
export type QuickDateVisual = BuiltInQuickDateId | 'days' | 'weeks' | 'weekday' | 'none'

export interface QuickDateDef {
  id: string
  /** "Day after tomorrow" (menus, settings). */
  label: string
  /** "In 2 days" (phone tiles). */
  short: string
  /** How the date is computed, shown in Settings ("+2 days", "Saturday"). */
  rule: string
  visual: QuickDateVisual
  date: (today: string) => string
}

export type NewReminderRule = 'none' | 'first'

export interface DateSettings {
  quickDates: QuickDateEntry[]
  /** Reminder times offered once a date is picked (`HH:MM`, sorted). */
  reminderTimes: string[]
  /** What picking a date does to a task that has no reminder yet. */
  newReminder: NewReminderRule
}

export const MAX_QUICK_DATES = 12
export const MAX_REMINDER_TIMES = 8
export const MAX_CUSTOM_AMOUNT = 60

const FULL_DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const SHORT_DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** This Saturday; on a Sunday, the next one. */
export function thisWeekend(date: string): string {
  const dow = dayOfWeek(date)
  if (dow === 6) return date
  return addDays(date, dow === 0 ? 6 : 6 - dow)
}

/** The next given weekday strictly after `date`. */
export function nextWeekday(date: string, weekday: number): string {
  return addDays(date, ((weekday - dayOfWeek(date) + 7) % 7) || 7)
}

const BUILT_INS: Record<BuiltInQuickDateId, Omit<QuickDateDef, 'id' | 'visual'>> = {
  today: { label: 'Today', short: 'Today', rule: 'Today', date: (t) => t },
  tomorrow: { label: 'Tomorrow', short: 'Tomorrow', rule: '+1 day', date: (t) => addDays(t, 1) },
  dayAfter: { label: 'Day after tomorrow', short: 'In 2 days', rule: '+2 days', date: (t) => addDays(t, 2) },
  weekend: { label: 'This weekend', short: 'Weekend', rule: 'Saturday', date: thisWeekend },
  nextWeek: { label: 'Next week', short: 'Next week', rule: 'Monday', date: nextMonday },
  inWeek: { label: 'In one week', short: 'In 1 week', rule: '+7 days', date: (t) => addDays(t, 7) },
}

export const BUILT_IN_IDS = Object.keys(BUILT_INS) as BuiltInQuickDateId[]

export const isBuiltIn = (id: string): id is BuiltInQuickDateId => id in BUILT_INS

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`

export function customQuickDateDef(id: string, custom: CustomQuickDate): QuickDateDef {
  switch (custom.kind) {
    case 'days':
      return {
        id,
        label: `In ${plural(custom.n, 'day')}`,
        short: `In ${plural(custom.n, 'day')}`,
        rule: `+${plural(custom.n, 'day')}`,
        visual: 'days',
        date: (t) => addDays(t, custom.n),
      }
    case 'weeks':
      return {
        id,
        label: `In ${plural(custom.n, 'week')}`,
        short: `In ${custom.n} wk`,
        rule: `+${plural(custom.n * 7, 'day')}`,
        visual: 'weeks',
        date: (t) => addDays(t, custom.n * 7),
      }
    case 'weekday':
      return {
        id,
        label: `Next ${FULL_DAY[custom.weekday]}`,
        short: `Next ${SHORT_DAY[custom.weekday]}`,
        rule: FULL_DAY[custom.weekday],
        visual: 'weekday',
        date: (t) => nextWeekday(t, custom.weekday),
      }
  }
}

export function quickDateDef(entry: QuickDateEntry): QuickDateDef | null {
  if (entry.custom) return customQuickDateDef(entry.id, entry.custom)
  if (isBuiltIn(entry.id)) return { id: entry.id, visual: entry.id, ...BUILT_INS[entry.id] }
  return null
}

export interface QuickDateOption extends QuickDateDef {
  /** The date it picks today (`YYYY-MM-DD`). */
  value: string
}

/** The enabled quick dates in the user's order, with the date each one picks today. */
export function quickDateOptions(settings: DateSettings, today: string): QuickDateOption[] {
  return settings.quickDates.flatMap((entry) => {
    const def = entry.on ? quickDateDef(entry) : null
    return def ? [{ ...def, value: def.date(today) }] : []
  })
}

export const DEFAULT_DATE_SETTINGS: DateSettings = {
  quickDates: BUILT_IN_IDS.map((id) => ({ id, on: true })),
  reminderTimes: ['09:00', '13:00', '18:00'],
  newReminder: 'none',
}

// ---------- editing ----------

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export const isTime = (value: unknown): value is string => typeof value === 'string' && TIME_RE.test(value)

function sameCustom(a: CustomQuickDate, b: CustomQuickDate): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Add a quick date of the user's own. Duplicates and entries beyond the limit are ignored. */
export function addCustomQuickDate(settings: DateSettings, custom: CustomQuickDate, id: string): DateSettings {
  const clean = sanitizeCustom(custom)
  if (!clean || settings.quickDates.length >= MAX_QUICK_DATES) return settings
  const existing = settings.quickDates.find((e) => e.custom && sameCustom(e.custom, clean))
  if (existing) {
    return { ...settings, quickDates: settings.quickDates.map((e) => (e === existing ? { ...e, on: true } : e)) }
  }
  return { ...settings, quickDates: [...settings.quickDates, { id, on: true, custom: clean }] }
}

/** Only quick dates the user added can be removed; built-ins can be turned off. */
export function removeQuickDate(settings: DateSettings, id: string): DateSettings {
  if (isBuiltIn(id)) return settings
  return { ...settings, quickDates: settings.quickDates.filter((e) => e.id !== id) }
}

export function toggleQuickDate(settings: DateSettings, id: string): DateSettings {
  return { ...settings, quickDates: settings.quickDates.map((e) => (e.id === id ? { ...e, on: !e.on } : e)) }
}

export function moveQuickDate(settings: DateSettings, id: string, delta: -1 | 1): DateSettings {
  const i = settings.quickDates.findIndex((e) => e.id === id)
  const j = i + delta
  if (i < 0 || j < 0 || j >= settings.quickDates.length) return settings
  const quickDates = [...settings.quickDates]
  ;[quickDates[i], quickDates[j]] = [quickDates[j], quickDates[i]]
  return { ...settings, quickDates }
}

export function addReminderTime(settings: DateSettings, time: string): DateSettings {
  if (!isTime(time) || settings.reminderTimes.includes(time) || settings.reminderTimes.length >= MAX_REMINDER_TIMES) {
    return settings
  }
  return { ...settings, reminderTimes: [...settings.reminderTimes, time].sort() }
}

export function removeReminderTime(settings: DateSettings, time: string): DateSettings {
  return { ...settings, reminderTimes: settings.reminderTimes.filter((t) => t !== time) }
}

// ---------- parsing (settings come back from Graph, so trust nothing) ----------

function sanitizeCustom(value: unknown): CustomQuickDate | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (v.kind === 'days' || v.kind === 'weeks') {
    const n = Math.floor(Number(v.n))
    return n >= 1 && n <= MAX_CUSTOM_AMOUNT ? { kind: v.kind, n } : null
  }
  if (v.kind === 'weekday') {
    const weekday = Number(v.weekday)
    return Number.isInteger(weekday) && weekday >= 0 && weekday <= 6 ? { kind: 'weekday', weekday } : null
  }
  return null
}

/** Settings from storage or Graph → valid settings. Unknown or broken parts fall back to defaults. */
export function normalizeDateSettings(raw: unknown): DateSettings {
  if (!raw || typeof raw !== 'object') return DEFAULT_DATE_SETTINGS
  const r = raw as Record<string, unknown>

  let quickDates = DEFAULT_DATE_SETTINGS.quickDates
  if (Array.isArray(r.quickDates)) {
    const seen = new Set<string>()
    const parsed: QuickDateEntry[] = []
    let customs = 0
    for (const item of r.quickDates as unknown[]) {
      if (!item || typeof item !== 'object') continue
      const e = item as Record<string, unknown>
      if (typeof e.id !== 'string' || !e.id || seen.has(e.id)) continue
      const on = e.on !== false
      if (isBuiltIn(e.id)) {
        parsed.push({ id: e.id, on })
      } else {
        const custom = sanitizeCustom(e.custom)
        if (!custom || customs >= MAX_QUICK_DATES - BUILT_IN_IDS.length) continue
        customs++
        parsed.push({ id: e.id, on, custom })
      }
      seen.add(e.id)
    }
    // Built-ins can't be removed, only turned off. One missing (say, added in a later version) is
    // appended, turned off.
    for (const id of BUILT_IN_IDS) if (!seen.has(id)) parsed.push({ id, on: false })
    quickDates = parsed
  }

  const reminderTimes = Array.isArray(r.reminderTimes)
    ? [...new Set((r.reminderTimes as unknown[]).filter(isTime))].sort().slice(0, MAX_REMINDER_TIMES)
    : DEFAULT_DATE_SETTINGS.reminderTimes

  const newReminder: NewReminderRule = r.newReminder === 'first' ? 'first' : 'none'
  return { quickDates, reminderTimes, newReminder }
}
