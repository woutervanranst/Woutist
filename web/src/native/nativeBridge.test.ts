import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { deleteAccountDb, openAccountDb, type WoutistDb } from '../services/db'
import { newLocalTask, type TodoList } from '../models/todo'
import type { AppServices } from '../app/AppServices'
import type { SyncEvent } from '../services/sync/syncEngine'

const native = vi.hoisted(() => {
  const listeners = new Map<string, (e?: unknown) => void>()
  return {
    listeners,
    setSnapshot: vi.fn(async () => {}),
    requestNotificationPermission: vi.fn(async () => ({ granted: true })),
    addListener: vi.fn(async (event: string, cb: (e?: unknown) => void) => {
      listeners.set(event, cb)
      return { remove: async () => void listeners.delete(event) }
    }),
  }
})
vi.mock('./plugins', () => ({ WoutistNative: native }))

const { NativeBridge } = await import('./nativeBridge')

const accountKey = 'bridge.test'
const list: TodoList = { id: 'L1', displayName: 'Tasks', wellknownListName: 'defaultList', isOwner: true, isShared: false, sortIndex: 0 }
let db: WoutistDb
let engineListeners: ((e: SyncEvent) => void)[]
let engine: { on: ReturnType<typeof vi.fn>; sync: ReturnType<typeof vi.fn> }
let bridge: InstanceType<typeof NativeBridge>

beforeEach(async () => {
  native.setSnapshot.mockClear()
  native.listeners.clear()
  db = openAccountDb(accountKey)
  await db.lists.put(list)
  engineListeners = []
  engine = {
    on: vi.fn((l: (e: SyncEvent) => void) => {
      engineListeners.push(l)
      return () => (engineListeners = engineListeners.filter((x) => x !== l))
    }),
    sync: vi.fn(async () => {}),
  }
  bridge = new NativeBridge({ db, engine } as unknown as AppServices, accountKey, { debounceMs: 20 })
})

afterEach(async () => {
  bridge.stop()
  db.close()
  await deleteAccountDb(accountKey)
})

const lastSnapshot = () => (native.setSnapshot.mock.calls.at(-1) as unknown as [{ snapshot: { tasks: { id: string }[]; accountKey: string } }])[0].snapshot

describe('NativeBridge', () => {
  it('pushes a snapshot of the open tasks after local changes', async () => {
    bridge.start()
    await db.tasks.put({ ...newLocalTask('L1', 'Milk'), id: 'T1' })
    await waitFor(() => expect(lastSnapshot().tasks.map((t) => t.id)).toEqual(['T1']))
    expect(lastSnapshot().accountKey).toBe(accountKey)
  })

  it('does not push the same snapshot twice', async () => {
    await db.tasks.put({ ...newLocalTask('L1', 'Milk'), id: 'T1' })
    bridge.start()
    await waitFor(() => expect(native.setSnapshot).toHaveBeenCalledTimes(1))
    engineListeners.forEach((l) => l('synced'))
    await new Promise((r) => setTimeout(r, 80))
    expect(native.setSnapshot).toHaveBeenCalledTimes(1)
  })

  it('tells the phone about changes that have not reached Graph yet', async () => {
    bridge.start()
    await db.outbox.add({ type: 'task.create', listId: 'L1', taskId: 'tmp_x', createdAt: 0, attempts: 0, nextAttemptAt: 0 })
    await waitFor(() => expect((lastSnapshot() as unknown as { outboxPending: boolean }).outboxPending).toBe(true))
  })

  it('syncs when the phone changed something in Graph', async () => {
    bridge.start()
    await waitFor(() => expect(native.listeners.has('changed')).toBe(true))
    native.listeners.get('changed')!()
    expect(engine.sync).toHaveBeenCalledWith({ reason: 'signal' })
  })

  it('stops pushing after stop()', async () => {
    bridge.start()
    await waitFor(() => expect(native.setSnapshot).toHaveBeenCalled())
    bridge.stop()
    native.setSnapshot.mockClear()
    await db.tasks.put({ ...newLocalTask('L1', 'Bread'), id: 'T2' })
    await new Promise((r) => setTimeout(r, 80))
    expect(native.setSnapshot).not.toHaveBeenCalled()
    expect(native.listeners.has('changed')).toBe(false)
  })
})
