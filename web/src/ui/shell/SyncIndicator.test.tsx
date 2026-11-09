import { FluentProvider, Toaster, webLightTheme } from '@fluentui/react-components'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiveUpdates } from '../../services/sync/liveUpdates'
import type { SyncOutcome, SyncStatus } from '../../services/sync/syncEngine'

const fake = vi.hoisted(() => ({ services: null as unknown }))
vi.mock('../../app/AppServices', () => ({ useServices: () => fake.services }))

const { SyncIndicator } = await import('./SyncIndicator')
const { ringFraction } = await import('../syncText')

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
const outcome = (patch: Partial<SyncOutcome> = {}): SyncOutcome => ({
  startedAt: 0,
  endedAt: 1,
  reason: 'manual',
  full: false,
  result: 'ok',
  lists: [{ listId: 'L1', name: 'Tasks', changed: 0, removed: 0 }],
  changesMs: 1,
  fullCheck: null,
  sent: 0,
  requests: 1,
  ...patch,
})

const renderIt = (onDetails = vi.fn()) => {
  render(
    <FluentProvider theme={webLightTheme}>
      <SyncIndicator onDetails={onDetails} />
      <Toaster toasterId="app" />
    </FluentProvider>,
  )
  return onDetails
}
const button = () => screen.getByRole('button', { name: /./ })

beforeEach(() => {
  status = { ...baseStatus, lastSyncAt: Date.now() - MIN }
  listeners = new Set()
  sync = vi.fn(async () => outcome())
  live = new LiveUpdates(true)
  fake.services = {
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
  vi.useRealTimers()
})

describe('SyncIndicator', () => {
  it('says "Up to date" after a recent sync', () => {
    renderIt()
    expect(button()).toHaveAccessibleName('Up to date')
  })

  it('never says "Up to date" before the first sync', () => {
    status = { ...baseStatus }
    renderIt()
    expect(button()).toHaveAccessibleName('Not synced yet')
  })

  it('lapses to "Last synced" on its own after 5 minutes (live updates off)', () => {
    vi.useFakeTimers()
    status = { ...baseStatus, lastSyncAt: Date.now() - 4 * MIN }
    renderIt()
    expect(button()).toHaveAccessibleName('Up to date')
    act(() => void vi.advanceTimersByTime(MIN + 100))
    expect(button().getAttribute('aria-label')).toMatch(/^Last synced /)
  })

  it('stays up to date with live updates on', () => {
    vi.useFakeTimers()
    live.setConnection(true)
    live.setSubscriptions(true)
    status = { ...baseStatus, lastSyncAt: Date.now() - 4 * MIN }
    renderIt()
    act(() => void vi.advanceTimersByTime(10 * MIN))
    expect(button()).toHaveAccessibleName('Up to date')
  })

  it('shows changes to send, offline and sync problems', () => {
    status = { ...status, pendingChanges: 2 }
    renderIt()
    expect(button()).toHaveAccessibleName('2 changes to send')
    setStatus({ state: 'offline' })
    expect(button()).toHaveAccessibleName('Offline · 2 changes to send')
    setStatus({ state: 'error', error: 'Forbidden' })
    expect(button()).toHaveAccessibleName('Sync problem: Forbidden')
  })

  it('shows a ring while syncing, filled by the progress', () => {
    renderIt()
    setStatus({ state: 'syncing', reason: 'startup', progress: { phase: 'changes', done: 6, total: 12 } })
    expect(screen.getByTestId('sync-ring')).toHaveAttribute('data-fraction', '0.5')
    setStatus({ progress: { phase: 'changes', done: 0, total: 0 } })
    expect(screen.getByTestId('sync-ring')).toHaveAttribute('data-fraction', 'unknown')
  })

  it('syncs when tapped, and says what it found in a toast', async () => {
    sync.mockResolvedValue(outcome({ lists: [{ listId: 'L1', name: 'Tasks', changed: 23, removed: 0 }] }))
    renderIt()
    fireEvent.click(button())
    expect(sync).toHaveBeenCalledWith({ reason: 'manual' })
    expect(await screen.findByText('Up to date · 23 tasks changed')).toBeInTheDocument()
  })

  it('says when a tap found nothing, and when it sent changes', async () => {
    renderIt()
    fireEvent.click(button())
    expect(await screen.findByText('Up to date · nothing new')).toBeInTheDocument()
    sync.mockResolvedValue(outcome({ sent: 3 }))
    fireEvent.click(button())
    expect(await screen.findByText('Up to date · 3 changes sent')).toBeInTheDocument()
  })

  it('leaves a failure to the error toast', async () => {
    sync.mockResolvedValue(outcome({ result: 'error', error: 'Forbidden' }))
    renderIt()
    fireEvent.click(button())
    await waitFor(() => expect(sync).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText(/Up to date ·/)).toBeNull()
  })

  it('shows what is running when tapped while syncing, without starting anything', async () => {
    renderIt()
    setStatus({ state: 'syncing', reason: 'visible', progress: { phase: 'changes', done: 7, total: 12 } })
    fireEvent.click(button())
    expect(await screen.findByText('Getting changes · 7 of 12 lists')).toBeInTheDocument()
    expect(sync).not.toHaveBeenCalled()
    setStatus({ progress: { phase: 'full', done: 1240, total: 8316 } })
    expect(screen.getByText(/Checking everything · 1,240 of 8,316 tasks/)).toBeInTheDocument()
  })

  it('opens the details from that popover', async () => {
    const onDetails = renderIt()
    setStatus({ state: 'syncing', reason: 'visible', progress: { phase: 'changes', done: 7, total: 12 } })
    fireEvent.click(button())
    fireEvent.click(await screen.findByRole('button', { name: 'Details' }))
    expect(onDetails).toHaveBeenCalledTimes(1)
    expect(sync).not.toHaveBeenCalled()
  })

  it('does not open the popover by itself when a sync starts after a tap', () => {
    renderIt()
    fireEvent.click(button()) // idle: this is a sync, not the popover
    setStatus({ state: 'syncing', reason: 'manual', progress: { phase: 'changes', done: 1, total: 12 } })
    expect(screen.queryByText(/Getting changes/)).toBeNull()
  })
})

describe('ringFraction', () => {
  it('is the share done, or null while the total is unknown', () => {
    expect(ringFraction({ phase: 'full', done: 25, total: 100 })).toBe(0.25)
    expect(ringFraction({ phase: 'full', done: 120, total: 100 })).toBe(1)
    expect(ringFraction({ phase: 'changes', done: 0, total: 0 })).toBeNull()
    expect(ringFraction(null)).toBeNull()
  })
})
