import { useCallback, useSyncExternalStore } from 'react'
import { DEFAULT_DATE_SETTINGS, type DateSettings, normalizeDateSettings } from '../models/quickDates'
import type { SmartListId, SortPref } from '../models/views'

export type ThemePref = 'system' | 'light' | 'dark'

export interface Prefs {
  theme: ThemePref
  smartLists: Record<SmartListId, boolean>
  confirmDelete: boolean
  /** Sort preference per view key. */
  sort: Record<string, SortPref>
  /** Whether the completed section is expanded, per view key. */
  showCompleted: Record<string, boolean>
  /**
   * Quick dates and reminder times. Unlike the rest, these are also saved in the Microsoft account so
   * every device offers the same ones (services/settingsSync.ts).
   */
  dates: DateSettings
  /** When `dates` was last changed, on any device (ISO); null while never changed. */
  datesUpdatedAt: string | null
  /** `dates` changed on this device and isn't saved to the account yet. */
  datesDirty: boolean
}

export const DEFAULT_PREFS: Prefs = {
  theme: 'system',
  smartLists: { today: true, important: true, planned: true, all: true, completed: true },
  confirmDelete: true,
  sort: {},
  showCompleted: {},
  dates: DEFAULT_DATE_SETTINGS,
  datesUpdatedAt: null,
  datesDirty: false,
}

const listeners = new Set<() => void>()
const cache = new Map<string, Prefs>()
const storageKey = (accountKey: string) => `woutist:prefs:${accountKey}`

function read(accountKey: string): Prefs {
  const cached = cache.get(accountKey)
  if (cached) return cached
  let prefs = DEFAULT_PREFS
  try {
    const raw = localStorage.getItem(storageKey(accountKey))
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Prefs>
      prefs = {
        ...DEFAULT_PREFS,
        ...parsed,
        smartLists: { ...DEFAULT_PREFS.smartLists, ...parsed.smartLists },
        dates: normalizeDateSettings(parsed.dates),
      }
    }
  } catch {
    // storage unavailable or corrupt: defaults
  }
  cache.set(accountKey, prefs)
  return prefs
}

function write(accountKey: string, prefs: Prefs) {
  cache.set(accountKey, prefs)
  try {
    localStorage.setItem(storageKey(accountKey), JSON.stringify(prefs))
  } catch {
    // ignore: preferences are a convenience
  }
  for (const l of listeners) l()
}

export function clearPrefs(accountKey: string) {
  cache.delete(accountKey)
  try {
    localStorage.removeItem(storageKey(accountKey))
  } catch {
    // ignore
  }
}

/** Current preferences of an account, outside React (e.g. for the Android app's snapshot). */
export function readPrefs(accountKey: string): Prefs {
  return read(accountKey)
}

/** Change an account's preferences outside React. */
export function updatePrefs(accountKey: string, fn: (p: Prefs) => Prefs): void {
  const current = read(accountKey)
  const next = fn(current)
  if (next !== current) write(accountKey, next)
}

/** Called after any account's preferences change. */
export function subscribePrefs(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Preferences of the signed-in account, kept in localStorage. Only `dates` is also saved to Graph. */
export function usePrefs(accountKey: string): [Prefs, (update: (p: Prefs) => Prefs) => void] {
  const prefs = useSyncExternalStore(subscribePrefs, () => read(accountKey))
  const update = useCallback(
    (fn: (p: Prefs) => Prefs) => write(accountKey, fn(read(accountKey))),
    [accountKey],
  )
  return [prefs, update]
}
