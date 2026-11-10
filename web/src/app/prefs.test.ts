import { beforeEach, describe, expect, it } from 'vitest'
import { clearPrefs, readPrefs } from './prefs'

let accountKey: string
let counter = 0
beforeEach(() => {
  accountKey = `prefs-test-${++counter}`
})

const store = (value: unknown) => localStorage.setItem(`woutist:prefs:${accountKey}`, JSON.stringify(value))

describe('prefs', () => {
  it('opens on the default list unless told otherwise', () => {
    expect(readPrefs(accountKey).startPage).toBe('tasks')
  })

  it('keeps a stored start page, and ignores one it does not know', () => {
    store({ startPage: 'today' })
    expect(readPrefs(accountKey).startPage).toBe('today')
    clearPrefs(accountKey)
    store({ startPage: 'somewhere' })
    expect(readPrefs(accountKey).startPage).toBe('tasks')
  })

  it('carries over what older versions stored about unsaved quick dates', () => {
    store({ datesUpdatedAt: '2026-11-05T10:00:00.000Z', datesDirty: true })
    const prefs = readPrefs(accountKey)
    expect(prefs.syncedUpdatedAt).toBe('2026-11-05T10:00:00.000Z')
    expect(prefs.syncedDirty).toBe(true)
    expect(prefs).not.toHaveProperty('datesDirty')
  })
})
