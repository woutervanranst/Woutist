import { describe, expect, it } from 'vitest'
import type { SyncLogEntry } from '../services/sync/syncTypes'
import type { LiveState } from '../services/sync/liveUpdates'
import type { SyncStatus } from '../services/sync/syncEngine'
import {
  describeSync,
  durationText,
  formatWhen,
  groupDurations,
  groupReasons,
  groupSyncLog,
  groupTimeRange,
  logDetails,
  logSummary,
  manualToast,
  progressText,
  reasonText,
  shouldDimList,
  statusLine,
} from './syncText'

const L = 'en-GB'
const MIN = 60_000
// Monday 9 November 2026, 13:18 (local time, whatever the zone of the machine).
const NOW = new Date(2026, 10, 9, 13, 18).getTime()
const at = (day: number, h: number, m: number, month = 10) => new Date(2026, month, day, h, m).getTime()

const status = (patch: Partial<SyncStatus> = {}): SyncStatus => ({
  state: 'idle',
  lastSyncAt: NOW - MIN,
  lastFullSyncAt: NOW - MIN,
  pendingChanges: 0,
  error: null,
  progress: null,
  reason: null,
  ...patch,
})
const off: LiveState = { state: 'off', reason: 'x' }
const on: LiveState = { state: 'on' }
const none: LiveState = { state: 'unavailable' }

describe('formatWhen', () => {
  it('shows a time today', () => expect(formatWhen(at(9, 9, 2), NOW, { locale: L })).toBe('09:02'))
  it('says yesterday', () => expect(formatWhen(at(8, 17, 45), NOW, { locale: L })).toBe('Yesterday 17:45'))
  it('shows the weekday within the last week', () => {
    expect(formatWhen(at(6, 17, 45), NOW, { locale: L })).toBe('Fri 17:45')
    expect(formatWhen(at(3, 8, 5), NOW, { locale: L })).toBe('Tue 08:05') // 6 days ago
  })
  it('shows a date from a week ago on', () => {
    expect(formatWhen(at(2, 17, 45), NOW, { locale: L })).toBe('2 Nov 17:45') // 7 days ago
    expect(formatWhen(at(30, 17, 45, 9), NOW, { locale: L })).toBe('30 Oct 17:45')
  })
  it('counts calendar days, not 24-hour spans', () => {
    const justAfterMidnight = new Date(2026, 10, 9, 0, 5).getTime()
    expect(formatWhen(new Date(2026, 10, 8, 23, 55).getTime(), justAfterMidnight, { locale: L })).toBe('Yesterday 23:55')
  })
  it('treats a time in the future (clock skew) as today', () => expect(formatWhen(NOW + 5 * MIN, NOW, { locale: L })).toBe('13:23'))
  it('reads as part of a sentence when asked', () => {
    expect(formatWhen(at(9, 13, 18), NOW, { locale: L, sentence: true })).toBe('today 13:18')
    expect(formatWhen(at(8, 17, 45), NOW, { locale: L, sentence: true })).toBe('yesterday 17:45')
    expect(formatWhen(at(6, 17, 45), NOW, { locale: L, sentence: true })).toBe('Fri 17:45')
  })
})

describe('describeSync', () => {
  const d = (s: Partial<SyncStatus>, live: LiveState = off, now = NOW) => describeSync(status(s), live, now, L)

  it('is up to date right after a successful sync', () => {
    expect(d({ lastSyncAt: NOW - MIN })).toMatchObject({ kind: 'upToDate', label: 'Up to date' })
  })

  it('lapses to "Last synced" after 5 minutes without live updates', () => {
    expect(d({ lastSyncAt: NOW - 5 * MIN + 1 }).kind).toBe('upToDate')
    expect(d({ lastSyncAt: at(9, 13, 12) })).toMatchObject({ kind: 'stale', label: 'Last synced 13:12' })
    expect(d({ lastSyncAt: at(6, 17, 45) })).toMatchObject({ kind: 'stale', label: 'Last synced Fri 17:45' })
  })

  it('tells when it will lapse, and not when live updates keep it up to date', () => {
    expect(d({ lastSyncAt: NOW - MIN }).lapsesAt).toBe(NOW - MIN + 5 * MIN)
    expect(d({ lastSyncAt: NOW - MIN }, on).lapsesAt).toBeNull()
    expect(d({ lastSyncAt: at(6, 17, 45) }).lapsesAt).toBeNull()
  })

  it('stays up to date with live updates on, however old the last sync', () => {
    expect(d({ lastSyncAt: at(6, 17, 45) }, on).kind).toBe('upToDate')
  })

  it('never shows a checkmark before a sync has succeeded', () => {
    for (const live of [off, on, none]) {
      expect(d({ lastSyncAt: null }, live)).toMatchObject({ kind: 'never', label: 'Not synced yet' })
    }
  })

  it('shows a sync in progress, with its progress', () => {
    const progress = { phase: 'changes' as const, done: 7, total: 12 }
    expect(d({ state: 'syncing', progress })).toMatchObject({
      kind: 'syncing',
      label: 'Syncing…',
      detail: 'Getting changes · 7 of 12 lists',
    })
    expect(d({ state: 'syncing', progress: null }).detail).toBeNull()
  })

  it('shows a sync problem first, whatever else is going on', () => {
    expect(d({ state: 'error', error: 'Forbidden', pendingChanges: 2 }, on)).toMatchObject({
      kind: 'error',
      label: 'Sync problem: Forbidden',
    })
    expect(d({ state: 'error', error: null }).label).toBe('Sync problem: unknown error')
  })

  it('shows offline before changes to send', () => {
    expect(d({ state: 'offline' }).label).toBe('Offline')
    expect(d({ state: 'offline', pendingChanges: 3 })).toMatchObject({ kind: 'offline', label: 'Offline · 3 changes to send' })
    expect(d({ state: 'offline', pendingChanges: 1 }).label).toBe('Offline · 1 change to send')
  })

  it('shows changes to send before up to date', () => {
    expect(d({ pendingChanges: 3 }, on)).toMatchObject({ kind: 'pending', label: '3 changes to send' })
    expect(d({ pendingChanges: 1 }).label).toBe('1 change to send')
  })

  it('checks every state of the priority order', () => {
    const everything = status({ state: 'error', error: 'e', pendingChanges: 1 })
    expect(describeSync(everything, on, NOW, L).kind).toBe('error')
    expect(describeSync({ ...everything, state: 'offline' }, on, NOW, L).kind).toBe('offline')
    expect(describeSync({ ...everything, state: 'idle' }, on, NOW, L).kind).toBe('pending')
    expect(describeSync({ ...everything, state: 'idle', pendingChanges: 0 }, on, NOW, L).kind).toBe('upToDate')
  })
})

describe('progressText', () => {
  it('counts lists while getting changes', () => {
    expect(progressText({ phase: 'changes', done: 7, total: 12 }, L)).toBe('Getting changes · 7 of 12 lists')
    expect(progressText({ phase: 'changes', done: 0, total: 1 }, L)).toBe('Getting changes · 0 of 1 list')
    expect(progressText({ phase: 'changes', done: 0, total: 0 }, L)).toBe('Getting changes…')
  })
  it('counts tasks while checking everything', () => {
    expect(progressText({ phase: 'full', done: 1240, total: 8316 }, L)).toBe('Checking everything · 1,240 of 8,316 tasks')
    expect(progressText({ phase: 'full', done: 0, total: 0 }, L)).toBe('Checking everything…')
  })
})

describe('shouldDimList', () => {
  const syncing = (patch: Partial<SyncStatus>) =>
    status({ state: 'syncing', reason: 'startup', progress: { phase: 'changes', done: 0, total: 3 }, ...patch })
  const old = NOW - 6 * MIN

  it('dims while the quick pass of a startup or visible sync runs and the data is old', () => {
    expect(shouldDimList(syncing({ lastSyncAt: old }), NOW)).toBe(true)
    expect(shouldDimList(syncing({ lastSyncAt: old, reason: 'visible' }), NOW)).toBe(true)
  })
  it('does not dim for background syncs', () => {
    for (const reason of ['interval', 'signal', 'online', 'reconnect', 'manual', 'manual-full'] as const) {
      expect(shouldDimList(syncing({ lastSyncAt: old, reason }), NOW)).toBe(false)
    }
  })
  it('does not dim when the last sync was recent (5 minutes or less)', () => {
    expect(shouldDimList(syncing({ lastSyncAt: NOW - 5 * MIN }), NOW)).toBe(false)
  })
  it('stops dimming as soon as the quick pass ends, before the full check', () => {
    expect(shouldDimList(syncing({ lastSyncAt: old, progress: { phase: 'full', done: 0, total: 9 } }), NOW)).toBe(false)
  })
  it('does not dim when idle, offline, failed, or before the first sync', () => {
    expect(shouldDimList(status({ lastSyncAt: old }), NOW)).toBe(false)
    expect(shouldDimList(syncing({ lastSyncAt: null }), NOW)).toBe(false)
    expect(shouldDimList(syncing({ lastSyncAt: old, state: 'offline' }), NOW)).toBe(false)
  })
})

const entry = (patch: Partial<SyncLogEntry> = {}): SyncLogEntry => ({
  startedAt: NOW,
  endedAt: NOW + 700,
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
const lists = (changed: number, removed: number) => [
  { listId: 'L1', name: 'Tasks', changed: changed - 2, removed: removed - 1 },
  { listId: 'L2', name: 'Work', changed: 2, removed: 1 },
]

describe('logSummary', () => {
  it('says nothing new', () => expect(logSummary(entry())).toBe('Nothing new'))
  it('counts one received task', () => {
    expect(logSummary(entry({ lists: [{ listId: 'L1', name: 'T', changed: 1, removed: 0 }] }))).toBe('1 task received')
  })
  it('counts changed and removed tasks across lists', () => {
    expect(logSummary(entry({ lists: lists(23, 2) }))).toBe('23 tasks changed, 2 removed')
    expect(logSummary(entry({ lists: [{ listId: 'L1', name: 'T', changed: 0, removed: 1 }] }))).toBe('1 task removed')
    expect(logSummary(entry({ lists: [{ listId: 'L1', name: 'T', changed: 4, removed: 0 }] }))).toBe('4 tasks changed')
  })
  it('counts changes sent', () => {
    expect(logSummary(entry({ sent: 3 }))).toBe('3 changes sent, nothing new')
    expect(logSummary(entry({ sent: 1 }))).toBe('1 change sent, nothing new')
    expect(logSummary(entry({ sent: 3, lists: lists(23, 2) }))).toBe('3 changes sent, 23 tasks changed, 2 removed')
  })
  it('shows a failure with its reason', () => {
    expect(logSummary(entry({ result: 'error', error: 'Forbidden' }))).toBe('Failed: Forbidden')
    expect(logSummary(entry({ result: 'offline', error: 'Failed to fetch' }))).toBe('Failed: Failed to fetch')
    expect(logSummary(entry({ result: 'offline' }))).toBe('Failed: no connection')
  })
})

describe('reasonText', () => {
  it('says why in plain words', () => {
    expect(reasonText(entry({ reason: 'startup' }))).toBe('Opened the app')
    expect(reasonText(entry({ reason: 'visible' }))).toBe('Came back to the app')
    expect(reasonText(entry({ reason: 'interval' }))).toBe('Every 5 minutes while open')
    expect(reasonText(entry({ reason: 'online' }))).toBe('Back online')
    expect(reasonText(entry({ reason: 'manual' }))).toBe('You tapped sync')
    expect(reasonText(entry({ reason: 'signal' }))).toBe('Change on another device')
    expect(reasonText(entry({ reason: 'reconnect' }))).toBe('Live connection restored')
  })
  it('adds that everything was checked', () => {
    expect(reasonText(entry({ reason: 'startup', full: true }))).toBe('Opened the app · checked everything')
    expect(reasonText(entry({ reason: 'manual-full', full: true }))).toBe('You asked to check everything')
  })
})

describe('durationText', () => {
  it('is short and readable', () => {
    expect(durationText(40)).toBe('<0.1 s')
    expect(durationText(700)).toBe('0.7 s')
    expect(durationText(9_940)).toBe('9.9 s')
    expect(durationText(41_400)).toBe('41 s')
    expect(durationText(65_000)).toBe('1 min 5 s')
  })
})

describe('manualToast', () => {
  it('says what a tap found', () => {
    expect(manualToast(entry({ lists: lists(23, 2) }))).toBe('Up to date · 23 tasks changed')
    expect(manualToast(entry({ lists: [{ listId: 'L1', name: 'T', changed: 1, removed: 0 }] }))).toBe('Up to date · 1 task changed')
    expect(manualToast(entry())).toBe('Up to date · nothing new')
    expect(manualToast(entry({ sent: 3 }))).toBe('Up to date · 3 changes sent')
    expect(manualToast(entry({ sent: 1 }))).toBe('Up to date · 1 change sent')
    expect(manualToast(entry({ sent: 2, lists: lists(5, 0) }))).toBe('Up to date · 5 tasks changed · 2 changes sent')
  })
  it('has nothing to say about a failure (the error toast does)', () => {
    expect(manualToast(entry({ result: 'error', error: 'x' }))).toBeNull()
  })
  it('says when the phone is offline', () => {
    expect(manualToast(entry({ result: 'offline' }))).toBe("Couldn't sync: no connection")
  })
})

describe('logDetails', () => {
  it('shows the phases, the lists that changed, requests and changes sent', () => {
    const rows = logDetails(
      entry({
        full: true,
        sent: 0,
        requests: 183,
        changesMs: 1800,
        lists: [
          { listId: 'a', name: 'Tasks', changed: 21, removed: 2 },
          { listId: 'b', name: 'Work', changed: 2, removed: 0 },
          { listId: 'c', name: 'Home', changed: 0, removed: 0 },
        ],
        fullCheck: { durationMs: 39_000, checked: 8316, differences: 0 },
      }),
      L,
    )
    expect(rows).toEqual([
      { text: 'Getting changes (3 lists)', value: '1.8 s' },
      { text: 'Tasks: 21 changed, 2 removed', indent: true },
      { text: 'Work: 2 changed', indent: true },
      { text: 'Checking everything (8,316 tasks)', value: '39 s' },
      { text: 'No differences found', indent: true },
      { text: 'Requests to Microsoft', value: '183' },
      { text: 'Changes sent', value: '0' },
    ])
  })

  it('says which tasks the quick sync had missed', () => {
    const rows = logDetails(entry({ full: true, fullCheck: { durationMs: 2000, checked: 10, differences: 3 } }), L)
    expect(rows).toContainEqual({ text: 'Corrected 3 tasks the quick sync had missed', indent: true })
    const one = logDetails(entry({ full: true, fullCheck: { durationMs: 2000, checked: 10, differences: 1 } }), L)
    expect(one).toContainEqual({ text: 'Corrected 1 task the quick sync had missed', indent: true })
  })

  it('shows the error', () => {
    const rows = logDetails(entry({ result: 'error', error: 'Forbidden' }), L)
    expect(rows.at(-1)).toEqual({ text: 'Error: Forbidden', tone: 'error' })
  })
})

describe('statusLine', () => {
  it('says when it last synced and last checked everything', () => {
    expect(statusLine(status({ lastSyncAt: at(9, 13, 18), lastFullSyncAt: at(9, 9, 2) }), NOW, L)).toBe(
      'Synced today 13:18 · everything checked today 09:02',
    )
  })
  it('leaves out what is not known', () => {
    expect(statusLine(status({ lastSyncAt: at(8, 17, 45), lastFullSyncAt: null }), NOW, L)).toBe('Synced yesterday 17:45')
    expect(statusLine(status({ lastSyncAt: null, lastFullSyncAt: null }), NOW, L)).toBe('Never synced on this device')
  })
})

describe('groupSyncLog', () => {
  // Quiet runs at 09:02, 09:10, ... today; the gaps are what matters, so each one takes `ms`.
  const quiet = (id: number, startedAt: number, patch: Partial<SyncLogEntry> = {}) =>
    entry({ id, startedAt, endedAt: startedAt + 700, reason: 'interval', ...patch })
  const changed = (n: number) => [{ listId: 'L1', name: 'Tasks', changed: n, removed: 0 }]

  it('combines consecutive nothing-new runs into one group, newest first', () => {
    const runs = [
      quiet(1, at(9, 9, 2), { endedAt: at(9, 9, 2) + 500, reason: 'startup' }),
      quiet(2, at(9, 9, 10)),
      quiet(3, at(9, 9, 20), { endedAt: at(9, 9, 20) + 1200 }),
      quiet(4, at(9, 9, 25)),
      quiet(5, at(9, 9, 30), { reason: 'visible' }),
    ]
    const items = groupSyncLog(runs, NOW)
    expect(items).toHaveLength(1)
    const group = items[0]!
    expect(group.kind).toBe('group')
    if (group.kind !== 'group') return
    expect(group.summary).toBe('Nothing new')
    expect(group.entries.map((e) => e.id)).toEqual([5, 4, 3, 2, 1])
    expect(group.entries).toHaveLength(5)
    expect(groupTimeRange(group, NOW, L)).toBe('09:02–09:30')
    expect(groupReasons(group)).toBe('Every 5 minutes while open, came back to the app, opened the app')
    expect(groupDurations(group)).toBe('0.5–1.2 s')
  })

  it('does not care in which order the runs are given', () => {
    const runs = [quiet(1, at(9, 9, 2)), quiet(2, at(9, 9, 10)), quiet(3, at(9, 9, 20))]
    const items = groupSyncLog([runs[1]!, runs[2]!, runs[0]!], NOW)
    expect(items).toHaveLength(1)
    expect(items[0]!.kind === 'group' && items[0]!.entries.map((e) => e.id)).toEqual([3, 2, 1])
  })

  it('splits groups at a run that changed something, and never groups that run', () => {
    const runs = [
      quiet(1, at(9, 9, 0)),
      quiet(2, at(9, 9, 5)),
      quiet(3, at(9, 9, 10), { lists: changed(2) }),
      quiet(4, at(9, 9, 15)),
      quiet(5, at(9, 9, 20)),
      quiet(6, at(9, 9, 25), { lists: changed(1) }),
    ]
    const items = groupSyncLog(runs, NOW)
    expect(items.map((i) => i.kind)).toEqual(['single', 'group', 'single', 'group'])
    expect(items.map((i) => (i.kind === 'single' ? i.entry.id : i.entries.map((e) => e.id)))).toEqual([6, [5, 4], 3, [2, 1]])
  })

  it('never groups a run that removed or sent something, or ran the full check', () => {
    const runs = [
      quiet(1, at(9, 9, 0), { lists: [{ listId: 'L1', name: 'T', changed: 0, removed: 1 }] }),
      quiet(2, at(9, 9, 5), { sent: 1 }),
      quiet(3, at(9, 9, 10), { full: true }),
      quiet(4, at(9, 9, 15), { fullCheck: { durationMs: 1000, checked: 10, differences: 0 } }),
      quiet(5, at(9, 9, 20), { reason: 'manual-full', full: true }),
    ]
    const items = groupSyncLog(runs, NOW)
    expect(items.map((i) => i.kind)).toEqual(['single', 'single', 'single', 'single', 'single'])
  })

  it('merges identical failures and keeps different ones apart', () => {
    const fail = (id: number, minute: number, error: string) =>
      quiet(id, at(9, 9, minute), { result: 'offline', error })
    const items = groupSyncLog(
      [fail(1, 0, 'No connection'), fail(2, 5, 'No connection'), fail(3, 10, 'Failed to fetch'), fail(4, 15, 'No connection'), fail(5, 20, 'No connection')],
      NOW,
    )
    expect(items.map((i) => (i.kind === 'single' ? i.entry.id : i.entries.map((e) => e.id)))).toEqual([[5, 4], 3, [2, 1]])
    const first = items[0]!
    expect(first.kind === 'group' && first.summary).toBe('Failed: No connection')
  })

  it('does not merge a failure with a quiet run', () => {
    const items = groupSyncLog([quiet(1, at(9, 9, 0)), quiet(2, at(9, 9, 5), { result: 'offline' }), quiet(3, at(9, 9, 10))], NOW)
    expect(items.map((i) => i.kind)).toEqual(['single', 'single', 'single'])
  })

  it('shows a lone quiet run as a single row', () => {
    const items = groupSyncLog([quiet(1, at(9, 9, 0))], NOW)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'single', entry: { id: 1 } })
  })

  it('leaves out runs more than 24 hours old', () => {
    const runs = [
      quiet(1, NOW - 25 * 60 * MIN),
      quiet(2, NOW - 24 * 60 * MIN - 1),
      quiet(3, NOW - 24 * 60 * MIN, { lists: changed(1) }),
      quiet(4, NOW - MIN),
    ]
    const items = groupSyncLog(runs, NOW)
    expect(items.map((i) => (i.kind === 'single' ? i.entry.id : 'group'))).toEqual([4, 3])
    expect(groupSyncLog([quiet(1, NOW - 30 * 60 * MIN)], NOW)).toEqual([])
  })

  it('shows the start with its day when the group began before today', () => {
    const items = groupSyncLog([quiet(1, at(8, 23, 50)), quiet(2, at(9, 0, 10)), quiet(3, at(9, 0, 20))], NOW)
    const group = items[0]!
    expect(group.kind).toBe('group')
    if (group.kind !== 'group') return
    expect(groupTimeRange(group, NOW, L)).toBe('Yesterday 23:50–00:20')
  })

  it('shows one duration when they are all the same', () => {
    const group = groupSyncLog([quiet(1, at(9, 9, 0)), quiet(2, at(9, 9, 5))], NOW)[0]!
    expect(group.kind === 'group' && groupDurations(group)).toBe('0.7 s')
  })

  it('writes both units when the durations differ in unit', () => {
    const group = groupSyncLog([quiet(1, at(9, 9, 0), { endedAt: at(9, 9, 0) + 41_000 }), quiet(2, at(9, 9, 5), { endedAt: at(9, 9, 5) + 65_000 })], NOW)[0]!
    expect(group.kind === 'group' && groupDurations(group)).toBe('41 s – 1 min 5 s')
  })
})
