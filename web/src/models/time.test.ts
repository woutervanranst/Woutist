import { describe, expect, it } from 'vitest'
import {
  addDays,
  daysBetween,
  dayOfWeek,
  graphToInstant,
  graphToLocalDate,
  instantToGraph,
  instantToZonedWall,
  localDateToGraph,
  todayLocal,
  userTimeZone,
  zonedWallToInstant,
} from './time'

// The test script pins TZ=Europe/Brussels (UTC+1 in winter, UTC+2 in summer).
describe('time helpers', () => {
  it('runs in the pinned test zone', () => {
    expect(userTimeZone()).toBe('Europe/Brussels')
  })

  it('converts Graph UTC wall time to an instant', () => {
    const d = graphToInstant({ dateTime: '2026-11-05T08:00:00.0000000', timeZone: 'UTC' })
    expect(d?.toISOString()).toBe('2026-11-05T08:00:00.000Z')
  })

  it('converts an IANA wall time to an instant (winter and summer offsets)', () => {
    expect(zonedWallToInstant('2026-11-05T09:00:00', 'Europe/Brussels').toISOString()).toBe(
      '2026-11-05T08:00:00.000Z',
    )
    expect(zonedWallToInstant('2026-07-01T09:00:00', 'Europe/Brussels').toISOString()).toBe(
      '2026-07-01T07:00:00.000Z',
    )
    expect(zonedWallToInstant('2026-07-01T09:00:00', 'America/New_York').toISOString()).toBe(
      '2026-07-01T13:00:00.000Z',
    )
  })

  it('treats unknown (e.g. Windows) zone names as UTC instead of failing', () => {
    expect(
      zonedWallToInstant('2026-11-05T09:00:00', 'W. Europe Standard Time').toISOString(),
    ).toBe('2026-11-05T09:00:00.000Z')
  })

  it('round-trips an instant through the user zone', () => {
    const instant = new Date('2026-03-29T01:30:00.000Z') // just after the spring-forward
    const g = instantToGraph(instant)
    expect(g.timeZone).toBe('Europe/Brussels')
    expect(g.dateTime).toBe('2026-03-29T03:30:00')
    expect(graphToInstant(g)?.toISOString()).toBe(instant.toISOString())
  })

  it('reads due dates expressed in the user zone verbatim', () => {
    expect(
      graphToLocalDate({ dateTime: '2026-11-05T00:00:00.0000000', timeZone: 'Europe/Brussels' }),
    ).toBe('2026-11-05')
  })

  it('reads due dates stored as local midnight in UTC (written by another client)', () => {
    // Midnight Brussels on Nov 5th == 23:00 UTC on Nov 4th.
    expect(
      graphToLocalDate({ dateTime: '2026-11-04T23:00:00.0000000', timeZone: 'UTC' }),
    ).toBe('2026-11-05')
  })

  it('writes due dates as local midnight in the user zone', () => {
    expect(localDateToGraph('2026-11-05')).toEqual({
      dateTime: '2026-11-05T00:00:00',
      timeZone: 'Europe/Brussels',
    })
  })

  it('formats wall time in UTC', () => {
    expect(instantToZonedWall(new Date('2026-11-05T08:00:00Z'), 'UTC')).toBe('2026-11-05T08:00:00')
  })

  it('computes today and date arithmetic', () => {
    expect(todayLocal(new Date('2026-11-04T23:30:00Z'))).toBe('2026-11-05')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(daysBetween('2026-11-04', '2026-11-11')).toBe(7)
    expect(dayOfWeek('2026-11-04')).toBe(3) // Wednesday
  })
})
