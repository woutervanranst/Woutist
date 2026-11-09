import { FluentProvider, webLightTheme } from '@fluentui/react-components'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { newLocalTask } from '../../models/todo'
import { WoutistDb } from '../../services/db'
import { LiveUpdates } from '../../services/sync/liveUpdates'
import type { SyncStatus } from '../../services/sync/syncEngine'
import type { SyncLogEntry } from '../../services/sync/syncTypes'

const fake = vi.hoisted(() => ({ services: null as unknown, native: false }))
vi.mock('../../app/AppServices', () => ({ useServices: () => fake.services }))
vi.mock('../../platform/native', () => ({
  get isNative() {
    return fake.native
  },
}))

const { SyncSettings } = await import('./SyncSettings')

const MIN = 60_000
const baseStatus: SyncStatus = {
  state: 'idle',
  lastSyncAt: null,
  lastFullSyncAt: null,
  pendingChanges: 0,
  error: null,
  progress: null,
  reason: null,
}

let db: WoutistDb
let dbCounter = 0
let status: SyncStatus
let listeners: Set<() => void>
let sync: ReturnType<typeof vi.fn>
let live: LiveUpdates

const setStatus = (patch: Partial<SyncStatus>) => {
  act(() => {
    status = { ...status, ...patch }
    listeners.forEach((l) => l())
  })
}

const entry = (patch: Partial<SyncLogEntry> = {}): Omit<SyncLogEntry, 'id'> => ({
  startedAt: Date.now() - 10 * MIN,
  endedAt: (patch.startedAt ?? Date.now() - 10 * MIN) + 700,
  reason: 'signal',
  full: false,
  result: 'ok',
  lists: [{ listId: 'L1', name: 'Tasks', changed: 0, removed: 0 }],
  changesMs: 600,
  fullCheck: null,
  sent: 0,
  requests: 3,
  ...patch,
})

beforeEach(() => {
  fake.native = false
  db = new WoutistDb(`test-syncsettings-${++dbCounter}`)
  status = { ...baseStatus, lastSyncAt: Date.now() - MIN, lastFullSyncAt: Date.now() - 2 * MIN }
  listeners = new Set()
  sync = vi.fn(async () => entry())
  live = new LiveUpdates(true)
  fake.services = {
    db,
    engine: {
      getStatus: () => status,
      subscribe: (l: () => void) => {
        listeners.add(l)
        return () => listeners.delete(l)
      },
      sync,
    },
    live,
  }
})
afterEach(() => {
  cleanup()
  db.close()
})

const renderIt = () =>
  render(
    <FluentProvider theme={webLightTheme}>
      <SyncSettings />
    </FluentProvider>,
  )

describe('SyncSettings status', () => {
  it('says it is up to date, and when it synced and checked everything', () => {
    renderIt()
    expect(screen.getByText('Up to date')).toBeInTheDocument()
    expect(screen.getByText(/^Synced today .* · everything checked today /)).toBeInTheDocument()
  })

  it('says "Not synced yet" and never "Up to date" before a sync succeeded', () => {
    status = { ...baseStatus }
    renderIt()
    expect(screen.getByText('Not synced yet')).toBeInTheDocument()
    expect(screen.queryByText('Up to date')).toBeNull()
  })

  it('shows the progress of a running sync', () => {
    renderIt()
    setStatus({ state: 'syncing', reason: 'manual', progress: { phase: 'full', done: 1240, total: 8316 } })
    expect(screen.getByText(/^Syncing…/)).toHaveTextContent('Syncing… (Checking everything · 1,240 of 8,316 tasks)')
  })
})

describe('SyncSettings live updates', () => {
  it('says when they are on', () => {
    live.setConnection(true)
    live.setSubscriptions(true)
    renderIt()
    expect(screen.getByText('Live updates on')).toBeInTheDocument()
    expect(screen.getByText('Changes made elsewhere arrive within seconds.')).toBeInTheDocument()
  })

  it('says why they are off, and what happens instead', () => {
    live.setConnection(false, "Couldn't register this phone: Failed to fetch")
    renderIt()
    expect(screen.getByText('Live updates off')).toBeInTheDocument()
    expect(screen.getByText(/Couldn't register this phone: Failed to fetch/)).toBeInTheDocument()
    expect(screen.getByText(/Checks every 5 minutes while open instead\./)).toBeInTheDocument()
  })

  it('says when they are not available (demo, or no API)', () => {
    fake.services = { ...(fake.services as object), live: new LiveUpdates(false) }
    renderIt()
    expect(screen.getByText('Live updates not available')).toBeInTheDocument()
  })
})

describe('SyncSettings waiting changes', () => {
  const op = (patch = {}) => ({ type: 'task.update' as const, listId: 'L1', taskId: 'T1', changes: {}, createdAt: 0, attempts: 0, nextAttemptAt: 0, ...patch })

  it('says nothing is waiting', async () => {
    renderIt()
    expect(await screen.findByText('Nothing waiting to be sent')).toBeInTheDocument()
  })

  it('counts the changes waiting to be sent', async () => {
    await db.outbox.bulkAdd([op(), op({ taskId: 'T2' }), op({ taskId: 'T3' })])
    renderIt()
    expect(await screen.findByText('3 changes waiting to be sent')).toBeInTheDocument()
    await db.outbox.clear()
    await db.outbox.add(op())
    expect(await screen.findByText('1 change waiting to be sent')).toBeInTheDocument()
  })

  it('shows the error of a change that keeps failing', async () => {
    await db.outbox.bulkAdd([op(), op({ taskId: 'T2', attempts: 3, lastError: 'Failed to fetch' })])
    renderIt()
    expect(await screen.findByText('2 changes waiting to be sent')).toBeInTheDocument()
    expect(screen.getByText(/Failed to fetch/)).toBeInTheDocument()
  })
})

describe('SyncSettings counts', () => {
  const seed = async () => {
    await db.lists.bulkPut([
      { id: 'L1', displayName: 'Tasks', wellknownListName: 'defaultList', isOwner: true, isShared: false, sortIndex: 0 },
      { id: 'L2', displayName: 'Work', wellknownListName: 'none', isOwner: true, isShared: false, sortIndex: 1 },
    ])
    const done = { completed: 1, status: 'completed', completedDate: '2026-01-01' } as const
    await db.tasks.bulkPut([
      { ...newLocalTask('L1', 'a'), id: 'T1' },
      { ...newLocalTask('L1', 'b'), id: 'T2' },
      { ...newLocalTask('L2', 'c'), id: 'T3', ...done },
    ])
  }

  it('counts lists, open and completed tasks on this device', async () => {
    await seed()
    renderIt()
    expect(await screen.findByText('On this device: 2 lists · 2 open tasks · 1 completed')).toBeInTheDocument()
  })

  it('says "phone" in the app', async () => {
    fake.native = true
    await seed()
    renderIt()
    expect(await screen.findByText(/^On this phone: 2 lists/)).toBeInTheDocument()
  })
})

describe('SyncSettings buttons', () => {
  it('syncs now, or checks everything', () => {
    renderIt()
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }))
    expect(sync).toHaveBeenLastCalledWith({ reason: 'manual' })
    fireEvent.click(screen.getByRole('button', { name: 'Check everything' }))
    expect(sync).toHaveBeenLastCalledWith({ reason: 'manual-full' })
  })

  it('waits while a sync runs', () => {
    renderIt()
    setStatus({ state: 'syncing', reason: 'visible', progress: { phase: 'changes', done: 1, total: 3 } })
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Check everything' })).toBeDisabled()
  })
})

describe('SyncSettings recent syncs', () => {
  it('lists the runs newest first, with what came in, why, and how long', async () => {
    const startedAt20 = Date.now() - 20 * MIN
    await db.syncLog.bulkAdd([
      entry({ startedAt: Date.now() - 30 * MIN, reason: 'interval' }),
      entry({
        startedAt: startedAt20,
        reason: 'startup',
        full: true,
        endedAt: startedAt20 + 41_000,
        lists: [{ listId: 'L1', name: 'Tasks', changed: 23, removed: 2 }],
      }),
      entry({ startedAt: Date.now() - 10 * MIN, reason: 'manual', sent: 3 }),
    ])
    renderIt()
    const rows = await screen.findAllByRole('button', { name: /nothing new|task|failed/i })
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('3 changes sent, nothing new'),
      expect.stringContaining('23 tasks changed, 2 removed'),
      expect.stringContaining('Nothing new'),
    ])
    expect(rows[0]).toHaveTextContent('You tapped sync')
    expect(rows[1]).toHaveTextContent('Opened the app · checked everything')
    expect(rows[1]).toHaveTextContent('41 s')
    expect(rows[2]).toHaveTextContent('Every 5 minutes while open')
  })

  it('shows a failure with its reason', async () => {
    await db.syncLog.add(entry({ result: 'offline', error: 'Failed to fetch' }))
    renderIt()
    expect(await screen.findByText('Failed: Failed to fetch')).toBeInTheDocument()
  })

  it('opens the details of a run when it is tapped', async () => {
    await db.syncLog.add(
      entry({
        full: true,
        reason: 'startup',
        requests: 183,
        lists: [
          { listId: 'a', name: 'Tasks', changed: 21, removed: 2 },
          { listId: 'b', name: 'Work', changed: 0, removed: 0 },
        ],
        fullCheck: { durationMs: 39_000, checked: 8316, differences: 3 },
      }),
    )
    renderIt()
    const row = await screen.findByRole('button', { name: /task/ })
    expect(row).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Requests to Microsoft')).toBeNull()
    fireEvent.click(row)
    expect(row).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Getting changes (2 lists)')).toBeInTheDocument()
    expect(screen.getByText('Tasks: 21 changed, 2 removed')).toBeInTheDocument()
    expect(screen.getByText('Checking everything (8,316 tasks)')).toBeInTheDocument()
    expect(screen.getByText('Corrected 3 tasks the quick sync had missed')).toBeInTheDocument()
    expect(within(screen.getByText('Requests to Microsoft').parentElement!).getByText('183')).toBeInTheDocument()
    fireEvent.click(row)
    expect(screen.queryByText('Requests to Microsoft')).toBeNull()
  })

  it('shows new runs as they are written, and says how many are kept', async () => {
    renderIt()
    expect(await screen.findByText('No syncs yet.')).toBeInTheDocument()
    expect(screen.getByText('Kept on this device: the last 100 syncs.')).toBeInTheDocument()
    await db.syncLog.add(entry())
    await waitFor(() => expect(screen.getByText('Nothing new')).toBeInTheDocument())
  })
})
