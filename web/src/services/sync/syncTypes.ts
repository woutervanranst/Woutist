/** Why a sync ran. Manual beats the background reasons when several are queued. */
export type SyncReason =
  | 'startup' // opened the app
  | 'visible' // came back to the app
  | 'interval' // every 5 minutes while open
  | 'online' // back online
  | 'manual' // you tapped sync
  | 'manual-full' // you asked to check everything (implies a full check)
  | 'signal' // change on another device
  | 'reconnect' // live connection restored

/** Highest first. */
const REASON_RANK: SyncReason[] = ['manual-full', 'manual', 'startup', 'visible', 'online', 'reconnect', 'signal', 'interval']

/** The more significant of two reasons (the one a queued follow-up run should keep). */
export function strongerReason(a: SyncReason, b: SyncReason): SyncReason {
  return REASON_RANK.indexOf(a) <= REASON_RANK.indexOf(b) ? a : b
}

/** How long a run stays in the log. */
export const SYNC_LOG_RETENTION_MS = 24 * 60 * 60 * 1000

export type SyncResult = 'ok' | 'offline' | 'error'

/** One finished run of the sync engine, as kept in the `syncLog` table (the last 24 hours). */
export interface SyncLogEntry {
  id?: number
  startedAt: number
  endedAt: number
  reason: SyncReason
  /** Whether everything was checked again in this run (not only what changed). */
  full: boolean
  result: SyncResult
  error?: string
  /** Quick pass: what each list received. */
  lists: { listId: string; name: string; changed: number; removed: number }[]
  /** Duration of the quick pass (ms). */
  changesMs: number
  /** The full check, when it had work to do: duration, tasks read and tasks that differed from the local copy. */
  fullCheck: { durationMs: number; checked: number; differences: number } | null
  /** Outbox operations completed during the run. */
  sent: number
  /** Requests to Microsoft during the run (approximate when other work overlaps). */
  requests: number
}
