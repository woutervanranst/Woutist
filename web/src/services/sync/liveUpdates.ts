export interface LiveState {
  state: 'on' | 'off' | 'unavailable'
  /** Why it is off. */
  reason?: string
}

/**
 * Whether this device gets near-instant sync signals. Two things must hold: the way signals reach this
 * device works (the web page's realtime connection, or the phone's FCM registration), and Graph has
 * subscriptions that notify the API. Without an API (or in the demo) it is unavailable.
 */
export class LiveUpdates {
  private readonly available: boolean
  private connection: { ok: boolean; reason?: string } = { ok: false }
  private subscriptions: boolean | null = null
  private state: LiveState
  private listeners = new Set<() => void>()

  constructor(available: boolean) {
    this.available = available
    this.state = this.compute()
  }

  getState = (): LiveState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** The way signals reach this device is working (or why not). */
  setConnection(ok: boolean, reason?: string): void {
    this.connection = { ok, ...(reason ? { reason } : {}) }
    this.update()
  }

  /** Whether the last update of the Graph subscriptions succeeded (null: not known yet). */
  setSubscriptions(ok: boolean | null): void {
    this.subscriptions = ok
    this.update()
  }

  private update() {
    const next = this.compute()
    if (next.state === this.state.state && next.reason === this.state.reason) return
    this.state = next
    for (const l of this.listeners) l()
  }

  private compute(): LiveState {
    if (!this.available) return { state: 'unavailable' }
    if (!this.connection.ok) return { state: 'off', reason: this.connection.reason ?? "This device isn't connected for live updates." }
    if (this.subscriptions === false) return { state: 'off', reason: "Couldn't set up change notifications with Microsoft." }
    if (this.subscriptions === null) return { state: 'off', reason: "Change notifications with Microsoft aren't set up yet." }
    return { state: 'on' }
  }
}
