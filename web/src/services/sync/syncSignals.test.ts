import type { SyncSignal } from '@woutist/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EnsureResult } from './graphSubscriptions'
import type { SyncEvent } from './syncEngine'
import { SyncSignals } from './syncSignals'

const HOUR = 60 * 60 * 1000

let syncCalls: { lists?: readonly string[] }[]
let syncedListeners: Set<(e: SyncEvent) => void>
let ensureCalls: string[][]
let ensureFails: boolean
let listIds: string[]
let realtime: { onSignal?: (s: SyncSignal) => void; onReconnect?: () => void; started: boolean }
let nowMs: number
let signals: SyncSignals
let accountCounter = 0

const emit = (e: SyncEvent) => syncedListeners.forEach((l) => l(e))
const settle = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => {
  vi.useFakeTimers()
  syncCalls = []
  syncedListeners = new Set()
  ensureCalls = []
  ensureFails = false
  listIds = ['L1', 'L2']
  realtime = { started: false }
  nowMs = Date.parse('2026-11-06T10:00:00.000Z')
  signals = new SyncSignals({
    accountKey: `acct-${++accountCounter}`,
    engine: {
      sync: async (options = {}) => {
        syncCalls.push(options)
      },
      on: (listener) => {
        syncedListeners.add(listener)
        return () => syncedListeners.delete(listener)
      },
    },
    listIds: async () => listIds,
    subscriptions: {
      ensure: async (ids): Promise<EnsureResult> => {
        ensureCalls.push([...ids])
        if (ensureFails) throw new Error('API down')
        return { created: ids.length, renewed: 0, deleted: 0, failed: 0 }
      },
    },
    createRealtime: (handlers) => {
      Object.assign(realtime, handlers)
      return {
        start: () => {
          realtime.started = true
        },
        stop: () => {
          realtime.started = false
        },
      }
    },
    now: () => nowMs,
  })
  signals.start()
})
afterEach(() => {
  signals.stop()
  vi.useRealTimers()
})

describe('SyncSignals', () => {
  it('starts the realtime connection', () => {
    expect(realtime.started).toBe(true)
  })

  it('syncs the lists named by signals that arrive close together, once', async () => {
    realtime.onSignal!({ type: 'changed', listIds: ['L1'] })
    await vi.advanceTimersByTimeAsync(100)
    realtime.onSignal!({ type: 'changed', listIds: ['L2', 'L1'] })
    await vi.advanceTimersByTimeAsync(299)
    expect(syncCalls).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(syncCalls).toEqual([{ lists: ['L1', 'L2'] }])
  })

  it('syncs everything after the connection comes back', () => {
    realtime.onReconnect!()
    expect(syncCalls).toEqual([{}])
  })

  it('ensures Graph subscriptions after a sync, then at most every 12 hours', async () => {
    emit('synced')
    await settle()
    expect(ensureCalls).toEqual([['L1', 'L2']])
    nowMs += 11 * HOUR
    emit('synced')
    await settle()
    expect(ensureCalls).toHaveLength(1)
    nowMs += 2 * HOUR
    emit('synced')
    await settle()
    expect(ensureCalls).toHaveLength(2)
  })

  it('ensures again as soon as the lists change', async () => {
    emit('synced')
    await settle()
    listIds = ['L1', 'L2', 'L3']
    emit('synced')
    await settle()
    expect(ensureCalls.at(-1)).toEqual(['L1', 'L2', 'L3'])
  })

  it('waits an hour after a failure', async () => {
    ensureFails = true
    emit('synced')
    await settle()
    emit('synced')
    await settle()
    expect(ensureCalls).toHaveLength(1)
    ensureFails = false
    nowMs += HOUR + 1
    emit('synced')
    await settle()
    expect(ensureCalls).toHaveLength(2)
  })

  it('ignores flush events', async () => {
    emit('flushed')
    await settle()
    expect(ensureCalls).toEqual([])
  })

  it('stops listening and closes the connection', async () => {
    signals.stop()
    expect(realtime.started).toBe(false)
    emit('synced')
    await settle()
    expect(ensureCalls).toEqual([])
  })
})
