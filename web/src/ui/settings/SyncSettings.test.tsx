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
  const changed = (n: number) => [{ listId: 'L1', name: 'Tasks', changed: n, removed: 0 }]
  const openLog = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Recent syncs' }))
    return await screen.findByRole('dialog', { name: 'Recent syncs' })
  }
  /** Five quiet runs, 5 minutes apart, the newest 20 minutes ago. */
  const quietRuns = (count = 5, patch: Partial<SyncLogEntry> = {}) =>
    Array.from({ length: count }, (_, i) => entry({ startedAt: Date.now() - (20 + 5 * (count - 1 - i)) * MIN, reason: 'interval', ...patch }))

  it('does not list the syncs in Settings, only a link that opens them', async () => {
    await db.syncLog.bulkAdd([entry({ lists: changed(4) }), ...quietRuns(2)])
    renderIt()
    expect(await screen.findByText(/^On this device/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Recent syncs' })).toBeInTheDocument()
    expect(screen.queryByText('4 tasks changed')).toBeNull()
    expect(screen.queryByText('Nothing new')).toBeNull()
    expect(screen.queryByText(/Kept on this device/)).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens the log in a dialog with a caption, and closes back to Settings', async () => {
    await db.syncLog.add(entry({ lists: changed(4) }))
    renderIt()
    const dialog = await openLog()
    expect(within(dialog).getByText('Syncs from the last 24 hours, kept on this device.')).toBeInTheDocument()
    expect(await within(dialog).findByText('4 tasks changed')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Recent syncs' })).toBeInTheDocument()
  })

  it('says when there is nothing in the last 24 hours', async () => {
    await db.syncLog.add(entry({ startedAt: Date.now() - 25 * 60 * MIN, lists: changed(4) }))
    renderIt()
    const dialog = await openLog()
    expect(await within(dialog).findByText('No syncs in the last 24 hours.')).toBeInTheDocument()
    expect(within(dialog).queryByText('4 tasks changed')).toBeNull()
  })

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
    const dialog = await openLog()
    const rows = await within(dialog).findAllByRole('button', { name: /nothing new|task|failed/i })
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('3 changes sent, nothing new'),
      expect.stringContaining('23 tasks changed, 2 removed'),
      expect.stringContaining('Nothing new'),
    ])
    expect(rows[0]).toHaveTextContent('You tapped sync')
    expect(rows[1]).toHaveTextContent('Opened the app · checked everything')
    expect(rows[1]).toHaveTextContent('41 s')
    expect(rows[2]).toHaveTextContent('Every 5 minutes while open')
    expect(rows[2]).not.toHaveTextContent('syncs')
  })

  it('combines similar runs into one row, and splits it at a run that did something', async () => {
    // Five quiet runs, then (newer) one with changes, then two more quiet ones.
    await db.syncLog.bulkAdd([
      ...quietRuns(5).map((e) => ({ ...e, startedAt: e.startedAt - 10 * MIN, endedAt: e.startedAt - 10 * MIN + 700 })),
      entry({ startedAt: Date.now() - 15 * MIN, lists: changed(2) }),
      entry({ startedAt: Date.now() - 10 * MIN, reason: 'visible' }),
      entry({ startedAt: Date.now() - 5 * MIN, reason: 'visible' }),
    ])
    renderIt()
    const dialog = await openLog()
    const rows = await within(dialog).findAllByRole('button', { name: /nothing new|task/i })
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringMatching(/Nothing new · 2 syncs.*Came back to the app/),
      expect.stringContaining('2 tasks changed'),
      expect.stringMatching(/Nothing new · 5 syncs.*Every 5 minutes while open.*0\.7 s/),
    ])
    expect(within(dialog).queryByText('Nothing new')).toBeNull()
  })

  it('shows the time range of a group', async () => {
    await db.syncLog.bulkAdd(quietRuns(3))
    renderIt()
    const dialog = await openLog()
    const group = await within(dialog).findByRole('button', { name: /3 syncs/ })
    const time = (minutesAgo: number) =>
      new Date(Date.now() - minutesAgo * MIN).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    expect(group).toHaveTextContent(`${time(30)}–${time(20)}`)
  })

  it('lists the runs of a group when it is tapped', async () => {
    await db.syncLog.bulkAdd([
      ...quietRuns(4, { reason: 'interval' }).map((e, i) => (i === 0 ? { ...e, reason: 'startup' as const, endedAt: e.startedAt + 1200 } : e)),
    ])
    renderIt()
    const dialog = await openLog()
    const group = await within(dialog).findByRole('button', { name: /4 syncs/ })
    expect(group).toHaveAttribute('aria-expanded', 'false')
    expect(within(dialog).queryByText(/Opened the app · /)).toBeNull()
    fireEvent.click(group)
    expect(group).toHaveAttribute('aria-expanded', 'true')
    const lines = within(dialog).getAllByTestId('group-run').map((l) => l.textContent)
    expect(lines).toHaveLength(4)
    expect(lines[0]).toMatch(/^\d\d:\d\d.* · Every 5 minutes while open · 0\.7 s$/)
    expect(lines[3]).toMatch(/^\d\d:\d\d.* · Opened the app · 1\.2 s$/)
    expect(within(dialog).queryByText('Requests to Microsoft')).toBeNull()
    fireEvent.click(group)
    expect(within(dialog).queryAllByTestId('group-run')).toHaveLength(0)
  })

  it('shows a lone quiet run like any other row', async () => {
    await db.syncLog.add(entry())
    renderIt()
    const dialog = await openLog()
    const row = await within(dialog).findByRole('button', { name: /Nothing new/ })
    expect(row).not.toHaveTextContent('syncs')
  })

  it('shows a failure with its reason, and combines identical failures', async () => {
    await db.syncLog.bulkAdd([
      entry({ startedAt: Date.now() - 30 * MIN, result: 'offline', error: 'No connection' }),
      entry({ startedAt: Date.now() - 25 * MIN, result: 'offline', error: 'No connection' }),
      entry({ startedAt: Date.now() - 20 * MIN, result: 'offline', error: 'Failed to fetch' }),
    ])
    renderIt()
    const dialog = await openLog()
    expect(await within(dialog).findByText('Failed: Failed to fetch')).toBeInTheDocument()
    expect(within(dialog).getByText('Failed: No connection · 2 syncs')).toBeInTheDocument()
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
    const dialog = await openLog()
    const row = await within(dialog).findByRole('button', { name: /task/ })
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

  it('shows new runs as they are written while it is open', async () => {
    renderIt()
    const dialog = await openLog()
    expect(await within(dialog).findByText('No syncs in the last 24 hours.')).toBeInTheDocument()
    await db.syncLog.add(entry({ lists: changed(1) }))
    await waitFor(() => expect(within(dialog).getByText('1 task received')).toBeInTheDocument())
    expect(within(dialog).queryByText('No syncs in the last 24 hours.')).toBeNull()
  })
})
