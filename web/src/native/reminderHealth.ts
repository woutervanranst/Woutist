import type { NativeSettingsTarget, NativeStatus } from './plugins'
import { WoutistNative } from './plugins'

export interface ReminderIssue {
  target: NativeSettingsTarget
  message: string
  action: string
}

/** What keeps the phone's reminders from arriving on time, most serious first. */
export function reminderIssue(status: NativeStatus | null): ReminderIssue | null {
  if (!status) return null
  if (!status.notifications)
    return { target: 'notifications', message: "Notifications are off, so you won't see your reminders.", action: 'Turn on notifications' }
  if (!status.exactAlarms)
    return { target: 'exactAlarms', message: 'Reminders may arrive a few minutes late.', action: 'Allow exact reminders' }
  if (!status.batteryUnrestricted)
    return {
      target: 'battery',
      message: 'Your phone may hold back reminders while Woutist is in the background.',
      action: 'Allow background activity',
    }
  return null
}

/** Ask for notifications in-app first; otherwise open the system screen that fixes `target`. */
export async function fixNativeSetting(target: NativeSettingsTarget): Promise<'granted' | 'settings'> {
  if (target === 'notifications') {
    const { granted } = await WoutistNative.requestNotificationPermission()
    if (granted) return 'granted'
  }
  await WoutistNative.openSystemSettings({ target })
  return 'settings'
}

const DISMISS_DAYS = 7
const dismissKey = (accountKey: string) => `woutist:reminder-banner-dismissed:${accountKey}`

export function bannerDismissed(accountKey: string, now: Date = new Date()): boolean {
  try {
    const until = Number(localStorage.getItem(dismissKey(accountKey)))
    return Number.isFinite(until) && until > now.getTime()
  } catch {
    return false
  }
}

export function dismissBanner(accountKey: string, now: Date = new Date()): void {
  try {
    localStorage.setItem(dismissKey(accountKey), String(now.getTime() + DISMISS_DAYS * 86_400_000))
  } catch {
    // storage unavailable: the banner comes back next start
  }
}
