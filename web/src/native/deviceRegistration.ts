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

/** Whether this phone is registered to receive sync signals; `error` says why not. */
export interface RegistrationResult {
  ok: boolean
  error?: string
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
  private result: RegistrationResult | null = null
  private listeners = new Set<(result: RegistrationResult) => void>()

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

  /** The outcome of the latest registration attempt; null before the first one ends. */
  getResult(): RegistrationResult | null {
    return this.result
  }

  subscribe(listener: (result: RegistrationResult) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private report(result: RegistrationResult) {
    if (this.result && this.result.ok === result.ok && this.result.error === result.error) return
    this.result = result
    for (const l of this.listeners) l(result)
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
      if (!token) {
        this.report({ ok: false, error: 'This phone has no push token (no Firebase in this build).' })
        return
      }
      if (token !== this.stored()) {
        await this.opts.api.putDevice(token)
        this.store(token)
      }
      this.report({ ok: true })
    } catch (error) {
      console.warn('Registering this device for sync signals failed', error)
      this.report({ ok: false, error: `Couldn't register this phone: ${error instanceof Error ? error.message : String(error)}` })
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
