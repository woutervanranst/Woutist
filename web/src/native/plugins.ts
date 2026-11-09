import { type PluginListenerHandle, registerPlugin } from '@capacitor/core'
import type { NativeSnapshot } from './snapshot'

/** The signed-in account as the Android app's MSAL sees it. `key` is `<objectId>.<tenantId>`. */
export interface NativeAccount {
  key: string
  name: string
  username: string
}

/**
 * Native Microsoft sign-in (MSAL Android), implemented in Kotlin by `WoutistAuthPlugin`.
 * `acquireToken` rejects with `code === 'sign_in_required'` when a silent token isn't possible.
 */
export interface WoutistAuthPlugin {
  signIn(): Promise<NativeAccount>
  signOut(): Promise<void>
  getAccount(): Promise<{ account: NativeAccount | null }>
  /** `expiresOn` is epoch milliseconds; missing on an older native side. */
  acquireToken(options: { scopes: string[]; interactive: boolean }): Promise<{ accessToken: string; expiresOn?: number }>
}

export const WoutistAuth = registerPlugin<WoutistAuthPlugin>('WoutistAuth')

export type NativeSettingsTarget = 'notifications' | 'exactAlarms' | 'battery'

export interface NativeStatus {
  notifications: boolean
  exactAlarms: boolean
  batteryUnrestricted: boolean
}

/**
 * Native reminders, widget data and notification taps, implemented in Kotlin by `WoutistNativePlugin`.
 * Events: `changed` (Graph changed: a change made on the phone went through, or a sync signal arrived)
 * and `navigate` (`{ url }`).
 */
export interface WoutistNativePlugin {
  setSnapshot(options: { snapshot: NativeSnapshot }): Promise<void>
  clear(): Promise<void>
  getStatus(): Promise<NativeStatus>
  requestNotificationPermission(): Promise<{ granted: boolean }>
  openSystemSettings(options: { target: NativeSettingsTarget }): Promise<void>
  /** Notifies again for every open task whose reminder has already come due; resolves with how many. */
  showPastReminders(): Promise<{ count: number }>
  consumeLaunchUrl(): Promise<{ url: string | null }>
  /** This phone's FCM token for sync signals; `null` when the build has no Firebase configuration. */
  getFcmToken(): Promise<{ token: string | null }>
  /** Where the account's Graph subscriptions point; the background refresh renews those. */
  setNotificationUrl(options: { url: string | null }): Promise<void>
  addListener(event: 'changed', listener: () => void): Promise<PluginListenerHandle>
  addListener(event: 'navigate', listener: (e: { url: string }) => void): Promise<PluginListenerHandle>
}

export const WoutistNative = registerPlugin<WoutistNativePlugin>('WoutistNative')
