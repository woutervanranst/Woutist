import type { LiveState } from '../services/sync/liveUpdates'
import type { SyncProgress, SyncStatus } from '../services/sync/syncEngine'
import { SYNC_LOG_RETENTION_MS, type SyncLogEntry, type SyncReason } from '../services/sync/syncTypes'

/** Text and decisions for the sync icon and Settings › Sync. Pure, so they are unit-tested. */

/** A sync this recent counts as current by itself. */
export const FRESH_MS = 5 * 60 * 1000

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

// ---------- when ----------

const timeOf = (d: Date, locale?: string) => d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

/**
 * "17:45" today, "Yesterday 17:45", "Fri 17:45" within the last week, else "3 Nov 17:45" (in the user's
 * locale). `sentence` makes it read after a word: "today 13:18", "yesterday 17:45".
 */
export function formatWhen(
  timestamp: number,
  now: number,
  { locale, sentence = false }: { locale?: string; sentence?: boolean } = {},
): string {
  const then = new Date(timestamp)
  const time = timeOf(then, locale)
  const days = Math.round((startOfDay(new Date(now)).getTime() - startOfDay(then).getTime()) / 86_400_000)
  if (days <= 0) return sentence ? `today ${time}` : time
  if (days === 1) return `${sentence ? 'yesterday' : 'Yesterday'} ${time}`
  if (days < 7) return `${then.toLocaleDateString(locale, { weekday: 'short' })} ${time}`
  return `${then.toLocaleDateString(locale, { day: 'numeric', month: 'short' })} ${time}`
}

export function durationText(ms: number): string {
  if (ms < 50) return '<0.1 s'
  if (ms < 10_000) return `${(Math.floor(ms / 100) / 10).toFixed(1)} s`
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds} s`
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`
}

// ---------- the icon ----------

export type SyncKind = 'syncing' | 'error' | 'offline' | 'pending' | 'upToDate' | 'stale' | 'never'

export interface SyncDescription {
  kind: SyncKind
  label: string
  /** More about a running sync (its progress). */
  detail: string | null
  /** When "up to date" stops being true by itself (live updates off); null when it doesn't lapse. */
  lapsesAt: number | null
}

/** The fraction of the progress ring to fill, or null when the total isn't known yet. */
export function ringFraction(progress: SyncProgress | null): number | null {
  if (!progress || progress.total <= 0) return null
  return Math.min(1, Math.max(0, progress.done / progress.total))
}

export function progressText(progress: SyncProgress | null, locale?: string): string | null {
  if (!progress) return null
  const n = (value: number) => value.toLocaleString(locale)
  if (progress.phase === 'changes') {
    if (progress.total === 0) return 'Getting changes…'
    return `Getting changes · ${n(progress.done)} of ${n(progress.total)} ${progress.total === 1 ? 'list' : 'lists'}`
  }
  if (progress.total === 0) return 'Checking everything…'
  return `Checking everything · ${n(progress.done)} of ${n(progress.total)} tasks`
}

/**
 * What the header icon says, highest priority first: a running sync, a sync problem, offline, changes still to
 * send, up to date (the last sync succeeded and is under 5 minutes old, or live updates are on), otherwise when
 * it last synced. Never "up to date" before a sync has succeeded.
 */
export function describeSync(status: SyncStatus, live: LiveState, now: number, locale?: string): SyncDescription {
  const pending = status.pendingChanges
  const toSend = plural(pending, 'change to send', 'changes to send')
  const base = { detail: null, lapsesAt: null }
  if (status.state === 'syncing') return { ...base, kind: 'syncing', label: 'Syncing…', detail: progressText(status.progress, locale) }
  if (status.state === 'error') return { ...base, kind: 'error', label: `Sync problem: ${status.error ?? 'unknown error'}` }
  if (status.state === 'offline') return { ...base, kind: 'offline', label: pending ? `Offline · ${toSend}` : 'Offline' }
  if (pending > 0) return { ...base, kind: 'pending', label: toSend }
  if (status.lastSyncAt === null) return { ...base, kind: 'never', label: 'Not synced yet' }
  const freshUntil = status.lastSyncAt + FRESH_MS
  if (live.state === 'on' || now < freshUntil) {
    return { ...base, kind: 'upToDate', label: 'Up to date', lapsesAt: live.state === 'on' ? null : freshUntil }
  }
  return { ...base, kind: 'stale', label: `Last synced ${formatWhen(status.lastSyncAt, now, { locale })}` }
}

/** "Synced today 13:18 · everything checked today 09:02". */
export function statusLine(status: SyncStatus, now: number, locale?: string): string {
  if (status.lastSyncAt === null) return 'Never synced on this device'
  const when = (t: number) => formatWhen(t, now, { locale, sentence: true })
  const synced = `Synced ${when(status.lastSyncAt)}`
  return status.lastFullSyncAt === null ? synced : `${synced} · everything checked ${when(status.lastFullSyncAt)}`
}

/**
 * The task list looks unconfirmed while the quick pass of a sync you'd notice (opening or returning to the
 * app) runs on data older than 5 minutes. It clears as soon as the quick pass ends, not after the full check.
 */
export function shouldDimList(status: SyncStatus, now: number): boolean {
  return (
    status.state === 'syncing' &&
    status.progress?.phase === 'changes' &&
    (status.reason === 'startup' || status.reason === 'visible') &&
    status.lastSyncAt !== null &&
    now - status.lastSyncAt > FRESH_MS
  )
}

// ---------- the log ----------

const received = (entry: SyncLogEntry) => ({
  changed: entry.lists.reduce((sum, l) => sum + l.changed, 0),
  removed: entry.lists.reduce((sum, l) => sum + l.removed, 0),
})

function receivedText(changed: number, removed: number): string {
  if (changed === 1 && removed === 0) return '1 task received'
  const parts = []
  if (changed > 0) parts.push(`${plural(changed, 'task', 'tasks')} changed`)
  if (removed > 0) parts.push(changed > 0 ? `${removed} removed` : `${plural(removed, 'task', 'tasks')} removed`)
  return parts.join(', ')
}

/** "1 task received", "Nothing new", "23 tasks changed, 2 removed", "3 changes sent, nothing new", "Failed: …". */
export function logSummary(entry: SyncLogEntry): string {
  if (entry.result !== 'ok') return `Failed: ${entry.error ?? 'no connection'}`
  const { changed, removed } = received(entry)
  const what = changed + removed > 0 ? receivedText(changed, removed) : null
  if (entry.sent > 0) return `${plural(entry.sent, 'change', 'changes')} sent, ${what ?? 'nothing new'}`
  return what ?? 'Nothing new'
}

const REASONS: Record<SyncReason, string> = {
  startup: 'Opened the app',
  visible: 'Came back to the app',
  interval: 'Every 5 minutes while open',
  online: 'Back online',
  manual: 'You tapped sync',
  'manual-full': 'You asked to check everything',
  signal: 'Change on another device',
  reconnect: 'Live connection restored',
}

/** Why it ran, in plain words, plus that everything was checked. */
export function reasonText(entry: Pick<SyncLogEntry, 'reason' | 'full'>): string {
  const base = REASONS[entry.reason]
  return entry.full && entry.reason !== 'manual-full' ? `${base} · checked everything` : base
}

/** The toast after you tap sync: what came in and went out. Null for a failure that has its own toast. */
export function manualToast(entry: SyncLogEntry): string | null {
  if (entry.result === 'offline') return "Couldn't sync: no connection"
  if (entry.result === 'error') return null
  const { changed } = received(entry)
  const parts = []
  if (changed > 0) parts.push(`${plural(changed, 'task', 'tasks')} changed`)
  if (entry.sent > 0) parts.push(`${plural(entry.sent, 'change', 'changes')} sent`)
  return `Up to date · ${parts.length ? parts.join(' · ') : 'nothing new'}`
}

export interface DetailRow {
  text: string
  value?: string
  indent?: boolean
  tone?: 'error'
}

/** The rows shown when a log entry is expanded. */
export function logDetails(entry: SyncLogEntry, locale?: string): DetailRow[] {
  const rows: DetailRow[] = [{ text: `Getting changes (${plural(entry.lists.length, 'list', 'lists')})`, value: durationText(entry.changesMs) }]
  for (const list of entry.lists) {
    if (list.changed + list.removed === 0) continue
    const parts = []
    if (list.changed > 0) parts.push(`${list.changed} changed`)
    if (list.removed > 0) parts.push(`${list.removed} removed`)
    rows.push({ text: `${list.name}: ${parts.join(', ')}`, indent: true })
  }
  if (entry.fullCheck) {
    const { checked, differences, durationMs } = entry.fullCheck
    rows.push({ text: `Checking everything (${plural(checked, 'task', 'tasks').replace(/^\d+/, checked.toLocaleString(locale))})`, value: durationText(durationMs) })
    rows.push({
      text: differences === 0 ? 'No differences found' : `Corrected ${plural(differences, 'task', 'tasks')} the quick sync had missed`,
      indent: true,
    })
  }
  rows.push({ text: 'Requests to Microsoft', value: String(entry.requests) })
  rows.push({ text: 'Changes sent', value: String(entry.sent) })
  if (entry.error) rows.push({ text: `Error: ${entry.error}`, tone: 'error' })
  return rows
}

// ---------- the log, similar runs combined ----------

export interface LogGroup {
  kind: 'group'
  /** What the runs in it have in common ("Nothing new", "Failed: No connection"). */
  summary: string
  failed: boolean
  /** At least two runs, newest first. */
  entries: SyncLogEntry[]
}

export type LogItem = { kind: 'single'; entry: SyncLogEntry } | LogGroup

/**
 * What a run has in common with the ones around it, or null when it is worth reading on its own: it changed
 * something, sent something, or checked everything. Runs that brought nothing share a key, and failures share
 * one only when they failed the same way.
 */
function groupKey(entry: SyncLogEntry): string | null {
  if (entry.result !== 'ok') return `failed:${logSummary(entry)}`
  const { changed, removed } = received(entry)
  if (changed + removed > 0 || entry.sent > 0 || entry.full || entry.fullCheck !== null) return null
  return 'nothing'
}

/**
 * The runs of the last 24 hours, newest first, with consecutive runs that brought nothing (or failed the same
 * way) combined into one group. A run that did something is never combined.
 */
export function groupSyncLog(entries: readonly SyncLogEntry[], now: number): LogItem[] {
  const cutoff = now - SYNC_LOG_RETENTION_MS
  const recent = entries
    .filter((e) => e.startedAt >= cutoff)
    .sort((a, b) => b.startedAt - a.startedAt || (b.id ?? 0) - (a.id ?? 0))
  const items: LogItem[] = []
  let run: SyncLogEntry[] = []
  let runKey: string | null = null
  const close = () => {
    const [only] = run
    if (run.length === 1 && only) items.push({ kind: 'single', entry: only })
    else if (only) items.push({ kind: 'group', summary: logSummary(only), failed: only.result !== 'ok', entries: run })
    run = []
    runKey = null
  }
  for (const entry of recent) {
    const key = groupKey(entry)
    if (run.length > 0 && (key === null || key !== runKey)) close()
    run.push(entry)
    runKey = key
    if (key === null) close()
  }
  close()
  return items
}

/** "09:02–09:30"; the start has its day when it isn't today ("Yesterday 23:50–00:20"). */
export function groupTimeRange(group: LogGroup, now: number, locale?: string): string {
  const first = group.entries.at(-1)!.startedAt
  const last = group.entries[0]!.startedAt
  const sameDay = startOfDay(new Date(first)).getTime() === startOfDay(new Date(last)).getTime()
  return `${formatWhen(first, now, { locale })}–${sameDay ? timeOf(new Date(last), locale) : formatWhen(last, now, { locale })}`
}

/** The distinct reasons the runs started, most frequent first: "Every 5 minutes while open, opened the app". */
export function groupReasons(group: LogGroup): string {
  const counts = new Map<SyncReason, number>()
  for (const entry of group.entries) counts.set(entry.reason, (counts.get(entry.reason) ?? 0) + 1)
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([reason], i) => (i === 0 ? REASONS[reason] : REASONS[reason].charAt(0).toLowerCase() + REASONS[reason].slice(1)))
    .join(', ')
}

/** "0.5–1.2 s", or just "0.7 s" when they all took the same. */
export function groupDurations(group: LogGroup): string {
  const times = group.entries.map((e) => e.endedAt - e.startedAt)
  const low = durationText(Math.min(...times))
  const high = durationText(Math.max(...times))
  if (low === high) return low
  return low.endsWith(' s') && !low.includes('min') && high.endsWith(' s') && !high.includes('min')
    ? `${low.slice(0, -2)}–${high}`
    : `${low} – ${high}`
}
