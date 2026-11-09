import type { GraphHookResponse } from '@woutist/contracts'

export interface DeviceRegistrationOptions {
  accountKey: string
  native: {
    getFcmToken(): Promise<{ token: string | null }>
    setNotificationUrl(options: { url: string | null }): Promise<void>
  }
  api: {
    putDevice(token: string): Promise<void>
    deleteDevice(token: string): Promise<void>
    getGraphHook(): Promise<GraphHookResponse>
  }
}

/**
 * Registers the phone's FCM token with the API, so sync signals reach it while the app is closed, and
 * gives native code the subscriptions' notification URL, so its background refresh can renew them.
 */
export class DeviceRegistration {
  private readonly opts: DeviceRegistrationOptions
  private readonly storageKey: string
  private hookSent = false
  private running: Promise<void> | null = null

  constructor(opts: DeviceRegistrationOptions) {
    this.opts = opts
    this.storageKey = `woutist:fcm:${opts.accountKey}`
  }

  /** Cheap to call often: the API is only called when the token changed (or the last attempt failed). */
  run(): Promise<void> {
    this.running ??= this.register().finally(() => {
      this.running = null
    })
    return this.running
  }

  /** Sign-out: this phone stops receiving the account's sync signals. */
  async unregister(): Promise<void> {
    const token = this.stored()
    if (!token) return
    await this.opts.api.deleteDevice(token)
    this.store(null)
  }

  /** Two independent steps: one failing (e.g. the hook call) must not stop the other. */
  private async register() {
    await Promise.all([this.registerToken(), this.sendHook()])
  }

  private async registerToken() {
    try {
      const { token } = await this.opts.native.getFcmToken()
      if (!token || token === this.stored()) return
      await this.opts.api.putDevice(token)
      this.store(token)
    } catch (error) {
      console.warn('Registering this device for sync signals failed', error)
    }
  }

  private async sendHook() {
    if (this.hookSent) return
    try {
      const hook = await this.opts.api.getGraphHook()
      await this.opts.native.setNotificationUrl({ url: hook.notificationUrl })
      this.hookSent = true
    } catch (error) {
      console.warn('Giving the notification URL to native code failed', error)
    }
  }

  private stored(): string | null {
    try {
      return localStorage.getItem(this.storageKey)
    } catch {
      return null
    }
  }

  private store(token: string | null) {
    try {
      if (token) localStorage.setItem(this.storageKey, token)
      else localStorage.removeItem(this.storageKey)
    } catch {
      // Without storage the token is registered again next time, which is harmless.
    }
  }
}
