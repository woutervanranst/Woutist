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
  acquireToken(options: { scopes: string[]; interactive: boolean }): Promise<{ accessToken: string }>
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
 * Events: `changed` (a change made on the phone reached Graph: sync) and `navigate` (`{ url }`).
 */
export interface WoutistNativePlugin {
  setSnapshot(options: { snapshot: NativeSnapshot }): Promise<void>
  clear(): Promise<void>
  getStatus(): Promise<NativeStatus>
  requestNotificationPermission(): Promise<{ granted: boolean }>
  openSystemSettings(options: { target: NativeSettingsTarget }): Promise<void>
  consumeLaunchUrl(): Promise<{ url: string | null }>
  addListener(event: 'changed', listener: () => void): Promise<PluginListenerHandle>
  addListener(event: 'navigate', listener: (e: { url: string }) => void): Promise<PluginListenerHandle>
}

export const WoutistNative = registerPlugin<WoutistNativePlugin>('WoutistNative')
