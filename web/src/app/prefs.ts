import { useCallback, useSyncExternalStore } from 'react'
import { DEFAULT_DATE_SETTINGS, type DateSettings, normalizeDateSettings } from '../models/quickDates'
import { DEFAULT_START_PAGE, type SmartListId, type SortPref, type StartPage, normalizeStartPage } from '../models/views'

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
   * Quick dates and reminder times. Unlike the rest, these (and `startPage`) are also saved in the
   * Microsoft account so every device has the same ones (services/settingsSync.ts).
   */
  dates: DateSettings
  /** Where the app opens. Saved in the account, like `dates`. */
  startPage: StartPage
  /** When `dates` or `startPage` was last changed, on any device (ISO); null while never changed. */
  syncedUpdatedAt: string | null
  /** `dates` or `startPage` changed on this device and isn't saved to the account yet. */
  syncedDirty: boolean
}

export const DEFAULT_PREFS: Prefs = {
  theme: 'system',
  smartLists: { today: true, important: true, planned: true, all: true, completed: true },
  confirmDelete: true,
  sort: {},
  showCompleted: {},
  dates: DEFAULT_DATE_SETTINGS,
  startPage: DEFAULT_START_PAGE,
  syncedUpdatedAt: null,
  syncedDirty: false,
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
      // `syncedUpdatedAt` and `syncedDirty` were called `datesUpdatedAt` and `datesDirty`.
      const parsed = JSON.parse(raw) as Partial<Prefs> & { datesUpdatedAt?: string | null; datesDirty?: boolean }
      const { datesUpdatedAt, datesDirty, ...current } = parsed
      prefs = {
        ...DEFAULT_PREFS,
        ...current,
        smartLists: { ...DEFAULT_PREFS.smartLists, ...parsed.smartLists },
        dates: normalizeDateSettings(parsed.dates),
        startPage: normalizeStartPage(parsed.startPage),
        syncedUpdatedAt: parsed.syncedUpdatedAt ?? datesUpdatedAt ?? null,
        syncedDirty: parsed.syncedDirty ?? datesDirty ?? false,
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

/** Preferences of the signed-in account, kept in localStorage. `dates` and `startPage` are also saved to Graph. */
export function usePrefs(accountKey: string): [Prefs, (update: (p: Prefs) => Prefs) => void] {
  const prefs = useSyncExternalStore(subscribePrefs, () => read(accountKey))
  const update = useCallback(
    (fn: (p: Prefs) => Prefs) => write(accountKey, fn(read(accountKey))),
    [accountKey],
  )
  return [prefs, update]
}
