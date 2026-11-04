import { useCallback, useSyncExternalStore } from 'react'
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
}

export const DEFAULT_PREFS: Prefs = {
  theme: 'system',
  smartLists: { important: true, planned: true, all: true, completed: true },
  confirmDelete: true,
  sort: {},
  showCompleted: {},
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

/** UI preferences for the signed-in account (kept in localStorage; never synced to Graph). */
export function usePrefs(accountKey: string): [Prefs, (update: (p: Prefs) => Prefs) => void] {
  const prefs = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => read(accountKey),
  )
  const update = useCallback(
    (fn: (p: Prefs) => Prefs) => write(accountKey, fn(read(accountKey))),
    [accountKey],
  )
  return [prefs, update]
}
