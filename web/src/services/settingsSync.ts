import { readPrefs, subscribePrefs, updatePrefs } from '../app/prefs'
import { normalizeDateSettings, type DateSettings } from '../models/quickDates'
import { isTempId } from '../models/todo'
import { type StartPage, normalizeStartPage } from '../models/views'
import type { WoutistDb } from './db'
import type { SyncEngine } from './sync/syncEngine'
import type { TaskService } from './taskService'

/**
 * Woutist's settings that follow the user to every device (quick dates, reminder times, start page) are saved
 * as an open extension on their default To Do list ("Tasks"). It needs no extra permission, and the
 * official app ignores it. Last writer wins, by the time of the change.
 */
export const SETTINGS_EXTENSION = 'com.wouteronarchitecture.woutist.settings'
const SCHEMA = 1

interface RemoteSettings {
  dates: DateSettings
  startPage: StartPage
  updatedAt: string
}

/** The extension's properties → settings, or null when missing or unreadable. */
export function parseRemoteSettings(ext: Record<string, unknown> | null): RemoteSettings | null {
  if (!ext || typeof ext.updatedAt !== 'string' || typeof ext.settings !== 'string') return null
  try {
    const parsed = JSON.parse(ext.settings) as { dates?: unknown; startPage?: unknown }
    // Older versions saved no start page: that means the default one.
    return { dates: normalizeDateSettings(parsed.dates), startPage: normalizeStartPage(parsed.startPage), updatedAt: ext.updatedAt }
  } catch {
    return null
  }
}

const PUSH_DELAY_MS = 1500

export class SettingsSync {
  private readonly db: WoutistDb
  private readonly svc: TaskService
  private readonly engine: SyncEngine
  private readonly accountKey: string
  private cleanups: (() => void)[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private running: Promise<void> | null = null
  private again = false

  constructor(deps: { db: WoutistDb; svc: TaskService; engine: SyncEngine; accountKey: string }) {
    this.db = deps.db
    this.svc = deps.svc
    this.engine = deps.engine
    this.accountKey = deps.accountKey
  }

  /** Pull after every sync; push shortly after a local change. */
  start(): void {
    if (this.cleanups.length) return
    this.cleanups.push(
      this.engine.on((event) => {
        if (event === 'synced') void this.run()
      }),
      subscribePrefs(() => {
        if (readPrefs(this.accountKey).syncedDirty) this.schedulePush()
      }),
    )
  }

  stop(): void {
    for (const c of this.cleanups) c()
    this.cleanups = []
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private schedulePush() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.run()
    }, PUSH_DELAY_MS)
  }

  /** Reconcile once (concurrent calls share a run, plus one follow-up). Failures retry on the next sync. */
  run(): Promise<void> {
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = this.reconcile()
      .catch((error) => console.warn('Saving settings to your account failed', error))
      .finally(() => {
        this.running = null
        if (this.again) {
          this.again = false
          void this.run()
        }
      })
    return this.running
  }

  private async reconcile(): Promise<void> {
    const list = await this.db.lists.filter((l) => l.wellknownListName === 'defaultList').first()
    if (!list || isTempId(list.id)) return
    const raw = await this.svc.getListExtension(list.id, SETTINGS_EXTENSION)
    const remote = parseRemoteSettings(raw)
    const local = readPrefs(this.accountKey)

    if (remote && (!local.syncedUpdatedAt || remote.updatedAt > local.syncedUpdatedAt)) {
      // Changed on another device more recently. Apply, unless it was edited here in the meantime.
      updatePrefs(this.accountKey, (p) =>
        p.syncedUpdatedAt === local.syncedUpdatedAt
          ? { ...p, dates: remote.dates, startPage: remote.startPage, syncedUpdatedAt: remote.updatedAt, syncedDirty: false }
          : p,
      )
      return
    }
    if (!local.syncedDirty || !local.syncedUpdatedAt) return
    await this.svc.saveListExtension(
      list.id,
      SETTINGS_EXTENSION,
      {
        schema: SCHEMA,
        updatedAt: local.syncedUpdatedAt,
        settings: JSON.stringify({ dates: local.dates, startPage: local.startPage }),
      },
      raw !== null,
    )
    updatePrefs(this.accountKey, (p) =>
      p.syncedUpdatedAt === local.syncedUpdatedAt ? { ...p, syncedDirty: false } : p,
    )
  }
}
