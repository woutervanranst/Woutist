import { registerPlugin } from '@capacitor/core'

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
