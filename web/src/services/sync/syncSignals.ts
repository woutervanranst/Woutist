import type { SyncSignal } from '@woutist/contracts'
import type { EnsureResult } from './graphSubscriptions'
import type { LiveUpdates } from './liveUpdates'
import type { SyncEngine, SyncOptions } from './syncEngine'

/** Signals for one change often come in a burst (task, then its steps): sync once for all of them. */
const DEBOUNCE_MS = 300
/** Subscriptions last ~70 hours and are renewed with 36 left, so checking every 12 hours is plenty. */
const ENSURE_EVERY_MS = 12 * 60 * 60 * 1000
const RETRY_AFTER_FAILURE_MS = 60 * 60 * 1000

interface EnsureRecord {
  at: number
  lists: string
  ok: boolean
}

export interface SyncSignalsOptions {
  accountKey: string
  engine: { sync(options: SyncOptions): Promise<unknown>; on: SyncEngine['on'] }
  /** Told whether the connection is open and the subscriptions are fine. */
  live?: LiveUpdates
  /** Ids of the lists that exist on the server (no temporary ids). */
  listIds: () => Promise<string[]>
  subscriptions: { ensure(listIds: readonly string[]): Promise<EnsureResult> }
  createRealtime: (handlers: {
    onSignal: (s: SyncSignal) => void
    onReconnect: () => void
    onConnectionChange: (connected: boolean) => void
  }) => {
    start(): void
    stop(): void
  }
  now?: () => number
}

/**
 * Near-instant sync on this device: Graph change notifications reach the API, which signals open
 * pages over the realtime connection; a signal syncs just the lists it names. After syncs, this also
 * keeps the account's Graph subscriptions alive (every device does, so any active one suffices).
 */
export class SyncSignals {
  private readonly opts: SyncSignalsOptions
  private readonly now: () => number
  private readonly storageKey: string
  private realtime: { start(): void; stop(): void } | null = null
  private detach: (() => void) | null = null
  private pending = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private ensuring = false

  constructor(opts: SyncSignalsOptions) {
    this.opts = opts
    this.now = opts.now ?? Date.now
    this.storageKey = `woutist:graphsubs:${opts.accountKey}`
  }

  start(): void {
    if (this.realtime) return
    this.realtime = this.opts.createRealtime({
      onSignal: (signal) => this.queue(signal.listIds),
      onReconnect: () => void this.opts.engine.sync({ reason: 'reconnect' }),
      onConnectionChange: (connected) => this.opts.live?.setConnection(connected),
    })
    this.opts.live?.setSubscriptions(this.readRecord()?.ok ?? null)
    this.realtime.start()
    this.detach = this.opts.engine.on((event) => {
      if (event === 'synced') void this.maybeEnsure()
    })
  }

  stop(): void {
    this.realtime?.stop()
    this.realtime = null
    this.detach?.()
    this.detach = null
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.pending.clear()
  }

  private queue(listIds: readonly string[]) {
    for (const id of listIds) this.pending.add(id)
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      const lists = [...this.pending]
      this.pending.clear()
      void this.opts.engine.sync({ reason: 'signal', lists })
    }, DEBOUNCE_MS)
  }

  private async maybeEnsure() {
    if (this.ensuring) return
    this.ensuring = true
    try {
      const ids = [...(await this.opts.listIds())].sort()
      const lists = ids.join('\n')
      const last = this.readRecord()
      const now = this.now()
      if (last && last.lists === lists && now - last.at < (last.ok ? ENSURE_EVERY_MS : RETRY_AFTER_FAILURE_MS)) {
        this.opts.live?.setSubscriptions(last.ok)
        return
      }
      let ok = true
      try {
        const result = await this.opts.subscriptions.ensure(ids)
        ok = result.failed === 0
      } catch (error) {
        ok = false
        console.warn('Could not update Graph subscriptions', error)
      }
      if (this.detach) {
        this.writeRecord({ at: now, lists, ok })
        this.opts.live?.setSubscriptions(ok)
      }
    } finally {
      this.ensuring = false
    }
  }

  private readRecord(): EnsureRecord | null {
    try {
      const raw = localStorage.getItem(this.storageKey)
      return raw ? (JSON.parse(raw) as EnsureRecord) : null
    } catch {
      return null
    }
  }

  private writeRecord(record: EnsureRecord) {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(record))
    } catch {
      // Without storage this simply runs after every sync.
    }
  }
}
