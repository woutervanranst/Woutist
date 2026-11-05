import { afterEach, describe, expect, it } from 'vitest'
import { bannerDismissed, dismissBanner, reminderIssue } from './reminderHealth'

const ok = { notifications: true, exactAlarms: true, batteryUnrestricted: true }

describe('reminderIssue', () => {
  it('is null when the phone allows everything (or the status is unknown)', () => {
    expect(reminderIssue(ok)).toBeNull()
    expect(reminderIssue(null)).toBeNull()
  })

  it('names the most serious problem first', () => {
    expect(reminderIssue({ notifications: false, exactAlarms: false, batteryUnrestricted: false })?.target).toBe('notifications')
    expect(reminderIssue({ ...ok, exactAlarms: false, batteryUnrestricted: false })?.target).toBe('exactAlarms')
    expect(reminderIssue({ ...ok, batteryUnrestricted: false })).toMatchObject({ target: 'battery', action: 'Allow background activity' })
  })
})

describe('banner dismissal', () => {
  afterEach(() => localStorage.clear())

  it('lasts a week per account', () => {
    const now = new Date('2026-11-05T12:00:00Z')
    expect(bannerDismissed('a', now)).toBe(false)
    dismissBanner('a', now)
    expect(bannerDismissed('a', new Date('2026-11-11T12:00:00Z'))).toBe(true)
    expect(bannerDismissed('a', new Date('2026-11-12T12:00:01Z'))).toBe(false)
    expect(bannerDismissed('b', now)).toBe(false)
  })
})
