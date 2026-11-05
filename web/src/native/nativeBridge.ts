import { liveQuery } from 'dexie'
import type { AppServices } from '../app/AppServices'
import { readPrefs, subscribePrefs } from '../app/prefs'
import type { Task, TodoList } from '../models/todo'
import { userTimeZone } from '../models/time'
import { WoutistNative } from './plugins'
import { buildSnapshot } from './snapshot'

/**
 * Keeps the Android app's native side (reminders, widget, quick add) up to date: pushes a snapshot of
 * the account after local changes, and syncs when a change made on the phone reached Graph.
 */
export class NativeBridge {
  private readonly services: Pick<AppServices, 'db' | 'engine'>
  private readonly accountKey: string
  private readonly debounceMs: number
  private running = false
  private data: { lists: TodoList[]; tasks: Task[]; outbox: number } | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private lastPushed: string | null = null
  private cleanups: (() => void)[] = []

  constructor(services: Pick<AppServices, 'db' | 'engine'>, accountKey: string, options: { debounceMs?: number } = {}) {
    this.services = services
    this.accountKey = accountKey
    this.debounceMs = options.debounceMs ?? 1000
  }

  start(): void {
    if (this.running) return
    this.running = true
    const { db, engine } = this.services
    const sub = liveQuery(() => Promise.all([db.lists.toArray(), db.tasks.toArray(), db.outbox.count()])).subscribe({
      next: ([lists, tasks, outbox]) => {
        this.data = { lists, tasks, outbox }
        this.schedule()
      },
      error: (error) => console.warn('Watching the local database failed', error),
    })
    this.cleanups.push(() => sub.unsubscribe())
    this.cleanups.push(engine.on(() => this.schedule()))
    this.cleanups.push(subscribePrefs(() => this.schedule()))
    const changed = WoutistNative.addListener('changed', () => void engine.sync())
    this.cleanups.push(() => void changed.then((h) => h.remove()))
    this.askForNotificationsOnce()
  }

  stop(): void {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    for (const cleanup of this.cleanups.splice(0)) cleanup()
  }

  private schedule() {
    if (!this.running) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.push()
    }, this.debounceMs)
  }

  private async push() {
    if (!this.running || !this.data) return
    const snapshot = buildSnapshot({
      accountKey: this.accountKey,
      lists: this.data.lists,
      tasks: this.data.tasks,
      sort: readPrefs(this.accountKey).sort,
      now: new Date(),
      timeZone: userTimeZone(),
      outboxPending: this.data.outbox > 0,
    })
    const content = JSON.stringify({ ...snapshot, generatedAt: '' })
    if (content === this.lastPushed) return
    try {
      await WoutistNative.setSnapshot({ snapshot })
      this.lastPushed = content
    } catch (error) {
      console.warn('Updating the phone’s reminders failed', error)
    }
  }

  /** Android asks for notification permission at most once per account, right after sign-in. */
  private askForNotificationsOnce() {
    const key = `woutist:notifications-asked:${this.accountKey}`
    try {
      if (localStorage.getItem(key)) return
      localStorage.setItem(key, '1')
    } catch {
      return
    }
    void WoutistNative.requestNotificationPermission().catch(() => {})
  }
}
