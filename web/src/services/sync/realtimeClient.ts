import type { SyncSignal } from '@woutist/contracts'

/** The part of `WebSocket` the client uses (tests pass a fake). */
export interface SocketLike {
  onopen: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: (() => void) | null
  close(): void
}

export interface RealtimeOptions {
  /** A fresh WebSocket URL (with a short-lived access token) for each connection. */
  getUrl: () => Promise<string>
  onSignal: (signal: SyncSignal) => void
  /** After a dropped connection is back: signals sent in between were missed, so sync everything. */
  onReconnect: () => void
  /** The connection opened (true) or closed, dropped or was shut on purpose (false). */
  onConnectionChange?: (connected: boolean) => void
  createSocket?: (url: string) => SocketLike
  isVisible?: () => boolean
}

const FIRST_RETRY_MS = 1000
/** Also the pace while the server answers 503 (sync not configured), so keep it modest. */
const MAX_RETRY_MS = 5 * 60 * 1000

function isSignal(value: unknown): value is SyncSignal {
  if (typeof value !== 'object' || value === null) return false
  const { type, listIds } = value as Record<string, unknown>
  return type === 'changed' && Array.isArray(listIds) && listIds.every((id) => typeof id === 'string')
}

function browserSocket(url: string): SocketLike {
  const ws = new WebSocket(url)
  const socket: SocketLike = { onopen: null, onmessage: null, onclose: null, close: () => ws.close() }
  ws.onopen = () => socket.onopen?.()
  ws.onmessage = (event) => socket.onmessage?.({ data: event.data })
  // An error is always followed by a close event.
  ws.onclose = () => socket.onclose?.()
  return socket
}

/**
 * Receives "these lists changed" signals over a WebSocket (Azure Web PubSub) while the page is
 * visible. Hidden pages disconnect: the sync engine already syncs when the page becomes visible.
 */
export class RealtimeClient {
  private readonly opts: Required<RealtimeOptions>
  private socket: SocketLike | null = null
  private isOpen = false
  private running = false
  /** Bumped on every disconnect, so a connect still waiting for its URL gives up. */
  private generation = 0
  private failures = 0
  /** The last connection dropped unexpectedly; the next open should trigger a catch-up sync. */
  private dropped = false
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private readonly onVisibility = () => {
    if (this.opts.isVisible()) this.connect()
    else this.disconnect()
  }

  constructor(opts: RealtimeOptions) {
    this.opts = {
      onConnectionChange: () => {},
      createSocket: browserSocket,
      isVisible: () => document.visibilityState === 'visible',
      ...opts,
    }
  }

  get connected(): boolean {
    return this.isOpen
  }

  start(): void {
    if (this.running) return
    this.running = true
    document.addEventListener('visibilitychange', this.onVisibility)
    if (this.opts.isVisible()) this.connect()
  }

  stop(): void {
    this.running = false
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.disconnect()
  }

  private connect(): void {
    if (!this.running || this.socket || this.retryTimer) return
    const generation = this.generation
    this.socket = { onopen: null, onmessage: null, onclose: null, close: () => {} } // placeholder while connecting
    void this.opts
      .getUrl()
      .then((url) => {
        if (generation !== this.generation) return
        const socket = this.opts.createSocket(url)
        this.socket = socket
        socket.onopen = () => this.opened()
        socket.onmessage = (event) => this.received(event.data)
        socket.onclose = () => this.lost()
      })
      .catch((error: unknown) => {
        if (generation !== this.generation) return
        console.warn('Realtime sync is unavailable', error)
        this.lost()
      })
  }

  private setOpen(open: boolean) {
    if (open === this.isOpen) return
    this.isOpen = open
    this.opts.onConnectionChange(open)
  }

  private opened() {
    this.setOpen(true)
    this.failures = 0
    if (this.dropped) {
      this.dropped = false
      this.opts.onReconnect()
    }
  }

  private received(data: unknown) {
    if (typeof data !== 'string') return
    let message: unknown
    try {
      message = JSON.parse(data)
    } catch {
      return
    }
    if (isSignal(message)) this.opts.onSignal({ type: 'changed', listIds: [...message.listIds] })
  }

  /** The connection closed (or never opened) without us asking: retry with exponential backoff. */
  private lost() {
    this.socket = null
    this.setOpen(false)
    this.dropped = true
    if (!this.running || !this.opts.isVisible()) return
    this.failures++
    const delay = Math.min(FIRST_RETRY_MS * 2 ** (this.failures - 1), MAX_RETRY_MS)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.connect()
    }, delay)
  }

  private disconnect() {
    this.generation++
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    const socket = this.socket
    this.socket = null
    this.setOpen(false)
    this.dropped = false
    this.failures = 0
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = null
      socket.close()
    }
  }
}
