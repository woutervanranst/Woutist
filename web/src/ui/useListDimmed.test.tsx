import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncStatus } from '../services/sync/syncEngine'

const fake = vi.hoisted(() => ({ services: null as unknown }))
vi.mock('../app/AppServices', () => ({ useServices: () => fake.services }))
vi.mock('../app/prefs', () => ({ usePrefs: () => [{}, () => {}] }))
vi.mock('../app/theme', () => ({ useMediaQuery: () => false }))

const { useListDimmed } = await import('./hooks')

const MIN = 60_000
let status: SyncStatus
let listeners: Set<() => void>
let renders: number

const change = (patch: Partial<SyncStatus>) =>
  act(() => {
    status = { ...status, ...patch }
    listeners.forEach((l) => l())
  })

function Probe() {
  renders++
  return <div>{useListDimmed() ? 'dimmed' : 'clear'}</div>
}

beforeEach(() => {
  renders = 0
  listeners = new Set()
  status = {
    state: 'idle',
    lastSyncAt: Date.now() - 2 * 60 * MIN,
    lastFullSyncAt: null,
    pendingChanges: 0,
    error: null,
    progress: null,
    reason: null,
  }
  fake.services = {
    engine: {
      getStatus: () => status,
      subscribe: (l: () => void) => {
        listeners.add(l)
        return () => listeners.delete(l)
      },
    },
  }
})
afterEach(cleanup)

describe('useListDimmed', () => {
  it('dims during the quick pass of a startup sync on old data, and clears when it ends', () => {
    render(<Probe />)
    expect(screen.getByText('clear')).toBeInTheDocument()
    change({ state: 'syncing', reason: 'startup', progress: { phase: 'changes', done: 0, total: 5 } })
    expect(screen.getByText('dimmed')).toBeInTheDocument()
    change({ progress: { phase: 'full', done: 0, total: 900 } })
    expect(screen.getByText('clear')).toBeInTheDocument()
  })

  it('does not re-render for progress steps that change nothing about dimming', () => {
    render(<Probe />)
    change({ state: 'syncing', reason: 'visible', progress: { phase: 'changes', done: 0, total: 50 } })
    const before = renders
    for (let done = 1; done <= 50; done++) change({ progress: { phase: 'changes', done, total: 50 } })
    expect(renders).toBe(before)
  })

  it('never dims for background syncs', () => {
    render(<Probe />)
    change({ state: 'syncing', reason: 'interval', progress: { phase: 'changes', done: 0, total: 5 } })
    expect(screen.getByText('clear')).toBeInTheDocument()
  })
})
