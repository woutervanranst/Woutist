import { readPrefs, subscribePrefs, updatePrefs } from '../app/prefs'
import { normalizeDateSettings, type DateSettings } from '../models/quickDates'
import { isTempId } from '../models/todo'
import type { WoutistDb } from './db'
import type { SyncEngine } from './sync/syncEngine'
import type { TaskService } from './taskService'

/**
 * Woutist's settings that follow the user to every device (quick dates, reminder times) are saved
 * as an open extension on their default To Do list ("Tasks"). It needs no extra permission, and the
 * official app ignores it. Last writer wins, by the time of the change.
 */
export const SETTINGS_EXTENSION = 'com.wouteronarchitecture.woutist.settings'
const SCHEMA = 1

interface RemoteSettings {
  dates: DateSettings
  updatedAt: string
}

/** The extension's properties → settings, or null when missing or unreadable. */
export function parseRemoteSettings(ext: Record<string, unknown> | null): RemoteSettings | null {
  if (!ext || typeof ext.updatedAt !== 'string' || typeof ext.settings !== 'string') return null
  try {
    const parsed = JSON.parse(ext.settings) as { dates?: unknown }
    return { dates: normalizeDateSettings(parsed.dates), updatedAt: ext.updatedAt }
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
        if (readPrefs(this.accountKey).datesDirty) this.schedulePush()
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

    if (remote && (!local.datesUpdatedAt || remote.updatedAt > local.datesUpdatedAt)) {
      // Changed on another device more recently. Apply, unless it was edited here in the meantime.
      updatePrefs(this.accountKey, (p) =>
        p.datesUpdatedAt === local.datesUpdatedAt
          ? { ...p, dates: remote.dates, datesUpdatedAt: remote.updatedAt, datesDirty: false }
          : p,
      )
      return
    }
    if (!local.datesDirty || !local.datesUpdatedAt) return
    await this.svc.saveListExtension(
      list.id,
      SETTINGS_EXTENSION,
      { schema: SCHEMA, updatedAt: local.datesUpdatedAt, settings: JSON.stringify({ dates: local.dates }) },
      raw !== null,
    )
    updatePrefs(this.accountKey, (p) =>
      p.datesUpdatedAt === local.datesUpdatedAt ? { ...p, datesDirty: false } : p,
    )
  }
}
