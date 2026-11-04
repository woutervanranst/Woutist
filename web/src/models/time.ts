/**
 * Date/time helpers for Graph `dateTimeTimeZone` values.
 *
 * Graph returns wall-clock times (`2026-11-05T09:00:00.0000000`) plus a time zone name. Woutist asks
 * Graph for times in the browser's IANA zone (Prefer: outlook.timezone), but these helpers handle any
 * IANA zone or UTC, so values written by other clients are interpreted correctly.
 */

export interface GraphDateTimeTimeZone {
  dateTime?: string
  timeZone?: string | null
}

const WALL_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/

export function userTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

function isUtcZone(tz: string | null | undefined): boolean {
  return !tz || /^(utc|gmt|etc\/utc|etc\/gmt|z)$/i.test(tz.trim())
}

const validZones = new Map<string, boolean>()
function isValidIanaZone(tz: string): boolean {
  let ok = validZones.get(tz)
  if (ok === undefined) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz })
      ok = true
    } catch {
      ok = false
    }
    validZones.set(tz, ok)
  }
  return ok
}

const formatters = new Map<string, Intl.DateTimeFormat>()
function zoneFormatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    formatters.set(tz, f)
  }
  return f
}

interface WallParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function wallPartsInZone(epochMs: number, tz: string): WallParts {
  const parts: Record<string, string> = {}
  for (const p of zoneFormatter(tz).formatToParts(new Date(epochMs))) parts[p.type] = p.value
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  }
}

function partsToUtcMs(p: WallParts): number {
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
}

/** Offset (ms) of `tz` from UTC at the given instant. */
function zoneOffsetMs(epochMs: number, tz: string): number {
  const whole = Math.floor(epochMs / 1000) * 1000
  return partsToUtcMs(wallPartsInZone(whole, tz)) - whole
}

function parseWall(wall: string): WallParts {
  const m = WALL_RE.exec(wall)
  if (!m) throw new Error(`Unrecognized date-time: ${wall}`)
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4] ?? 0),
    minute: Number(m[5] ?? 0),
    second: Number(m[6] ?? 0),
  }
}

const pad = (n: number, len = 2) => String(n).padStart(len, '0')

function formatWall(p: WallParts): string {
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`
}

/** Convert a wall-clock time in `tz` to an absolute instant. Unknown zones are treated as UTC. */
export function zonedWallToInstant(wall: string, tz: string | null | undefined): Date {
  const guess = partsToUtcMs(parseWall(wall))
  if (isUtcZone(tz) || !isValidIanaZone(tz!)) return new Date(guess)
  const offset = zoneOffsetMs(guess, tz!)
  let instant = guess - offset
  // Second pass corrects instants that straddle a DST transition.
  const offset2 = zoneOffsetMs(instant, tz!)
  if (offset2 !== offset) instant = guess - offset2
  return new Date(instant)
}

/** Wall-clock representation (`YYYY-MM-DDTHH:mm:ss`) of an instant in `tz`. */
export function instantToZonedWall(instant: Date, tz: string = userTimeZone()): string {
  if (isUtcZone(tz)) {
    return formatWall({
      year: instant.getUTCFullYear(),
      month: instant.getUTCMonth() + 1,
      day: instant.getUTCDate(),
      hour: instant.getUTCHours(),
      minute: instant.getUTCMinutes(),
      second: instant.getUTCSeconds(),
    })
  }
  return formatWall(wallPartsInZone(instant.getTime(), tz))
}

/** Calendar date (`YYYY-MM-DD`) of an instant in `tz`. */
export function instantToLocalDate(instant: Date, tz: string = userTimeZone()): string {
  return instantToZonedWall(instant, tz).slice(0, 10)
}

/** Graph dateTimeTimeZone → absolute instant (null-safe). */
export function graphToInstant(value: GraphDateTimeTimeZone | null | undefined): Date | null {
  if (!value?.dateTime) return null
  return zonedWallToInstant(value.dateTime, value.timeZone)
}

/**
 * Graph dateTimeTimeZone that represents a calendar date (due date, completed date) → `YYYY-MM-DD`
 * as seen in the user's zone. When the value is already expressed in the user's zone (the normal
 * case, thanks to the Prefer header) the date part is taken verbatim.
 */
export function graphToLocalDate(
  value: GraphDateTimeTimeZone | null | undefined,
  tz: string = userTimeZone(),
): string | null {
  if (!value?.dateTime) return null
  if (value.timeZone === tz) return value.dateTime.slice(0, 10)
  const instant = graphToInstant(value)
  return instant ? instantToLocalDate(instant, tz) : null
}

/** `YYYY-MM-DD` → Graph dateTimeTimeZone at local midnight in the user's zone. */
export function localDateToGraph(date: string, tz: string = userTimeZone()) {
  return { dateTime: `${date}T00:00:00`, timeZone: tz }
}

/** Instant → Graph dateTimeTimeZone in the user's zone. */
export function instantToGraph(instant: Date, tz: string = userTimeZone()) {
  return { dateTime: instantToZonedWall(instant, tz), timeZone: tz }
}

/** Today's date in the user's zone (`YYYY-MM-DD`). */
export function todayLocal(now: Date = new Date(), tz: string = userTimeZone()): string {
  return instantToLocalDate(now, tz)
}

/** Add whole days to a `YYYY-MM-DD` date. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

/** Day of week (0 = Sunday) of a `YYYY-MM-DD` date. */
export function dayOfWeek(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** Whole days from `from` to `to` (both `YYYY-MM-DD`). */
export function daysBetween(from: string, to: string): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000)
}
