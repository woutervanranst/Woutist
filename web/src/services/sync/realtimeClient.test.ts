import type { SyncSignal } from '@woutist/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RealtimeClient, type SocketLike } from './realtimeClient'

class FakeSocket implements SocketLike {
  static all: FakeSocket[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  closed = false
  readonly url: string
  constructor(url: string) {
    this.url = url
    FakeSocket.all.push(this)
  }
  close() {
    this.closed = true
    this.onclose?.()
  }
  open() {
    this.onopen?.()
  }
  receive(data: unknown) {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) })
  }
  drop() {
    this.onclose?.()
  }
}

let visible: boolean
let signals: SyncSignal[]
let reconnects: number
let urlCalls: number
let client: RealtimeClient

const flush = () => vi.advanceTimersByTimeAsync(0)
const latest = () => FakeSocket.all.at(-1)!

beforeEach(() => {
  vi.useFakeTimers()
  FakeSocket.all = []
  visible = true
  signals = []
  reconnects = 0
  urlCalls = 0
  client = new RealtimeClient({
    getUrl: async () => `wss://pubsub.test/${++urlCalls}`,
    onSignal: (s) => signals.push(s),
    onReconnect: () => reconnects++,
    createSocket: (url) => new FakeSocket(url),
    isVisible: () => visible,
  })
})
afterEach(() => {
  client.stop()
  vi.useRealTimers()
})

const setVisible = (value: boolean) => {
  visible = value
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('RealtimeClient', () => {
  it('connects on start and forwards change signals', async () => {
    client.start()
    await flush()
    latest().open()
    expect(client.connected).toBe(true)
    latest().receive({ type: 'changed', listIds: ['L1', 'L2'] })
    expect(signals).toEqual([{ type: 'changed', listIds: ['L1', 'L2'] }])
    expect(reconnects).toBe(0)
  })

  it('ignores messages that are not change signals', async () => {
    client.start()
    await flush()
    latest().open()
    latest().receive('not json')
    latest().receive({ type: 'other' })
    latest().receive({ type: 'changed', listIds: 'L1' })
    latest().receive({ type: 'changed', listIds: ['L1', 3] })
    expect(signals).toEqual([])
  })

  it('reconnects with backoff after a drop, then asks for a catch-up sync', async () => {
    client.start()
    await flush()
    latest().open()
    latest().drop()
    expect(client.connected).toBe(false)
    await vi.advanceTimersByTimeAsync(999)
    expect(FakeSocket.all).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(FakeSocket.all).toHaveLength(2)
    // A second failure waits longer.
    latest().drop()
    await vi.advanceTimersByTimeAsync(1999)
    expect(FakeSocket.all).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    latest().open()
    expect(reconnects).toBe(1)
  })

  it('backs off when the URL cannot be fetched', async () => {
    let fail = true
    client = new RealtimeClient({
      getUrl: async () => {
        urlCalls++
        if (fail) throw new Error('503')
        return 'wss://pubsub.test/ok'
      },
      onSignal: () => {},
      onReconnect: () => reconnects++,
      createSocket: (url) => new FakeSocket(url),
      isVisible: () => visible,
    })
    client.start()
    await flush()
    expect(urlCalls).toBe(1)
    fail = false
    await vi.advanceTimersByTimeAsync(1000)
    expect(FakeSocket.all).toHaveLength(1)
  })

  it('disconnects while hidden and reconnects when visible again, without a catch-up sync', async () => {
    client.start()
    await flush()
    const first = latest()
    first.open()
    setVisible(false)
    expect(first.closed).toBe(true)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(FakeSocket.all).toHaveLength(1)
    setVisible(true)
    await flush()
    latest().open()
    expect(FakeSocket.all).toHaveLength(2)
    expect(reconnects).toBe(0)
  })

  it('does not connect while hidden', async () => {
    visible = false
    client.start()
    await flush()
    expect(FakeSocket.all).toHaveLength(0)
  })

  it('stops for good', async () => {
    client.start()
    await flush()
    latest().open()
    client.stop()
    expect(latest().closed).toBe(true)
    await vi.advanceTimersByTimeAsync(120_000)
    expect(FakeSocket.all).toHaveLength(1)
  })
})
