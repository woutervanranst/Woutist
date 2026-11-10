import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readPrefs, updatePrefs } from '../app/prefs'
import { DEFAULT_DATE_SETTINGS, addReminderTime } from '../models/quickDates'
import { FakeGraph } from '../test/fakeGraph'
import { WoutistDb } from './db'
import { createGraphClient } from './graphClient'
import { SETTINGS_EXTENSION, SettingsSync } from './settingsSync'
import { SyncEngine } from './sync/syncEngine'
import { TaskService } from './taskService'

const server = setupServer()
let fake: FakeGraph
let db: WoutistDb
let engine: SyncEngine
let settings: SettingsSync
let tasksList: string
let accountKey: string
let counter = 0

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterAll(() => server.close())
beforeEach(async () => {
  fake = new FakeGraph()
  server.resetHandlers(...fake.handlers())
  tasksList = fake.addList('Tasks', { wellknownListName: 'defaultList' })
  accountKey = `settings-test-${++counter}`
  db = new WoutistDb(`test-settings-${counter}`)
  const svc = new TaskService(createGraphClient(async () => 'token'), 'Europe/Brussels')
  engine = new SyncEngine(db, svc, 'Europe/Brussels')
  settings = new SettingsSync({ db, svc, engine, accountKey })
  await engine.sync({ reason: 'manual' })
})
afterEach(() => {
  settings.stop()
  engine.stop()
  db.close()
  server.resetHandlers()
})

const editLocally = (at: string) =>
  updatePrefs(accountKey, (p) => ({
    ...p,
    dates: addReminderTime(p.dates, '07:30'),
    syncedUpdatedAt: at,
    syncedDirty: true,
  }))

const stored = () => {
  const ext = fake.listExtension(tasksList, SETTINGS_EXTENSION)
  return ext && { updatedAt: ext.updatedAt, dates: JSON.parse(ext.settings as string).dates }
}

describe('SettingsSync', () => {
  it('writes nothing while the settings were never changed', async () => {
    await settings.run()
    expect(fake.requests.filter((r) => r.method !== 'GET')).toEqual([])
  })

  it('saves a local change to the default list, then updates it in place', async () => {
    editLocally('2026-11-05T10:00:00.000Z')
    await settings.run()
    expect(stored()).toEqual({
      updatedAt: '2026-11-05T10:00:00.000Z',
      dates: { ...DEFAULT_DATE_SETTINGS, reminderTimes: ['07:30', '09:00', '13:00', '18:00'] },
    })
    expect(readPrefs(accountKey).syncedDirty).toBe(false)

    updatePrefs(accountKey, (p) => ({
      ...p,
      dates: { ...p.dates, newReminder: 'first' },
      syncedUpdatedAt: '2026-11-05T11:00:00.000Z',
      syncedDirty: true,
    }))
    await settings.run()
    expect(stored()?.dates.newReminder).toBe('first')
    expect(fake.requests.filter((r) => r.method === 'POST').length).toBe(1)
    expect(fake.requests.filter((r) => r.method === 'PATCH').length).toBe(1)
  })

  it('takes settings changed more recently on another device', async () => {
    editLocally('2026-11-05T10:00:00.000Z')
    fake.lists.get(tasksList)!.extensions.set(SETTINGS_EXTENSION, {
      extensionName: SETTINGS_EXTENSION,
      updatedAt: '2026-11-05T12:00:00.000Z',
      settings: JSON.stringify({ dates: { ...DEFAULT_DATE_SETTINGS, reminderTimes: ['08:00'] } }),
    })
    await settings.run()
    const prefs = readPrefs(accountKey)
    expect(prefs.dates.reminderTimes).toEqual(['08:00'])
    expect(prefs.syncedUpdatedAt).toBe('2026-11-05T12:00:00.000Z')
    expect(prefs.syncedDirty).toBe(false)
    expect(fake.requests.filter((r) => r.method !== 'GET')).toEqual([])
  })

  it('overwrites older settings from another device', async () => {
    fake.lists.get(tasksList)!.extensions.set(SETTINGS_EXTENSION, {
      extensionName: SETTINGS_EXTENSION,
      updatedAt: '2026-11-05T09:00:00.000Z',
      settings: JSON.stringify({ dates: { ...DEFAULT_DATE_SETTINGS, reminderTimes: ['08:00'] } }),
    })
    editLocally('2026-11-05T10:00:00.000Z')
    await settings.run()
    expect(stored()?.dates.reminderTimes).toEqual(['07:30', '09:00', '13:00', '18:00'])
  })

  it('keeps a change made while offline and saves it after the next sync', async () => {
    settings.start()
    fake.failNext('GET', /extensions/, 0)
    editLocally('2026-11-05T10:00:00.000Z')
    await settings.run()
    expect(readPrefs(accountKey).syncedDirty).toBe(true)
    await engine.sync({ reason: 'manual' })
    await settings.run()
    expect(stored()?.updatedAt).toBe('2026-11-05T10:00:00.000Z')
    expect(readPrefs(accountKey).syncedDirty).toBe(false)
  })

  it('saves the start page with the quick dates, and takes one changed on another device', async () => {
    updatePrefs(accountKey, (p) => ({ ...p, startPage: 'today', syncedUpdatedAt: '2026-11-05T10:00:00.000Z', syncedDirty: true }))
    await settings.run()
    expect(JSON.parse(fake.listExtension(tasksList, SETTINGS_EXTENSION)!.settings as string).startPage).toBe('today')

    fake.lists.get(tasksList)!.extensions.set(SETTINGS_EXTENSION, {
      extensionName: SETTINGS_EXTENSION,
      updatedAt: '2026-11-05T12:00:00.000Z',
      settings: JSON.stringify({ dates: DEFAULT_DATE_SETTINGS, startPage: 'planned' }),
    })
    await settings.run()
    expect(readPrefs(accountKey).startPage).toBe('planned')
  })

  it('reads settings saved by an older version (no start page) as the default one', async () => {
    updatePrefs(accountKey, (p) => ({ ...p, startPage: 'today' }))
    fake.lists.get(tasksList)!.extensions.set(SETTINGS_EXTENSION, {
      extensionName: SETTINGS_EXTENSION,
      updatedAt: '2026-11-05T12:00:00.000Z',
      settings: JSON.stringify({ dates: DEFAULT_DATE_SETTINGS }),
    })
    await settings.run()
    expect(readPrefs(accountKey).startPage).toBe('tasks')
  })
})
