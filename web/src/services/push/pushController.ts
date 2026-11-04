import type { PushSubscriptionDto } from '@woutist/contracts'
import type { WoutistDb } from '../db'
import type { SyncEngine } from '../sync/syncEngine'
import { PushApi } from './pushApi'
import { desiredReminders, fingerprint } from './reminders'

export type PushState = 'unsupported' | 'denied' | 'off' | 'on'

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/**
 * Web Push for reminders on this device. The server only learns the ids and times of upcoming
 * reminders; titles are looked up locally by the service worker when a push arrives.
 */
export class PushController {
  private readonly db: WoutistDb
  private readonly engine: SyncEngine
  private readonly api: PushApi
  private readonly vapidKey: string
  private readonly prefKey: string
  private readonly lastSentKey: string
  private unsubscribe: (() => void) | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private listeners = new Set<() => void>()

  constructor(opts: { db: WoutistDb; engine: SyncEngine; api: PushApi; vapidKey: string; accountKey: string }) {
    this.db = opts.db
    this.engine = opts.engine
    this.api = opts.api
    this.vapidKey = opts.vapidKey
    this.prefKey = `woutist:push:${opts.accountKey}`
    this.lastSentKey = `woutist:push:last:${opts.accountKey}`
  }

  static isSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
    )
  }

  get enabled(): boolean {
    try {
      return localStorage.getItem(this.prefKey) === '1'
    } catch {
      return false
    }
  }

  private setEnabled(on: boolean) {
    try {
      if (on) localStorage.setItem(this.prefKey, '1')
      else {
        localStorage.removeItem(this.prefKey)
        localStorage.removeItem(this.lastSentKey)
      }
    } catch {
      // ignore
    }
    for (const l of this.listeners) l()
  }

  state(): PushState {
    if (!PushController.isSupported()) return 'unsupported'
    if (Notification.permission === 'denied') return 'denied'
    return this.enabled && Notification.permission === 'granted' ? 'on' : 'off'
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Re-bind this browser's subscription to the signed-in user and keep reminders reconciled. */
  start(): void {
    if (this.unsubscribe) return
    this.unsubscribe = this.engine.on(() => this.scheduleReconcile())
    if (this.state() === 'on') {
      void this.registerSubscription().then(() => this.scheduleReconcile(0)).catch(() => {})
    }
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    if (this.timer) clearTimeout(this.timer)
  }

  private async registerSubscription(): Promise<void> {
    const registration = await navigator.serviceWorker.ready
    let sub = await registration.pushManager.getSubscription()
    if (!sub) {
      sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(this.vapidKey),
      })
    }
    await this.api.putSubscription(sub.toJSON() as PushSubscriptionDto)
  }

  async enable(): Promise<PushState> {
    if (!PushController.isSupported()) return 'unsupported'
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') {
      for (const l of this.listeners) l()
      return permission === 'denied' ? 'denied' : 'off'
    }
    await this.registerSubscription()
    this.setEnabled(true)
    await this.reconcile(true)
    return 'on'
  }

  /** Stop push on this device only (other devices keep their subscriptions). */
  async disable(): Promise<void> {
    try {
      const registration = await navigator.serviceWorker.getRegistration()
      const sub = await registration?.pushManager.getSubscription()
      if (sub) {
        await this.api.deleteSubscription(sub.endpoint).catch(() => {})
        await sub.unsubscribe()
      }
    } finally {
      this.setEnabled(false)
    }
  }

  /** Remove everything the reminder service stores for this user (all devices). */
  async removeServerData(): Promise<void> {
    await this.api.deleteMe()
    await this.disable()
  }

  private scheduleReconcile(delay = 2000) {
    if (this.state() !== 'on') return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.reconcile().catch(() => {})
    }, delay)
  }

  /** Send the current set of upcoming reminders if it changed since the last successful send. */
  async reconcile(force = false): Promise<void> {
    if (this.state() !== 'on') return
    const reminders = desiredReminders(await this.db.tasks.toArray())
    const fp = fingerprint(reminders)
    let last: string | null = null
    try {
      last = localStorage.getItem(this.lastSentKey)
    } catch {
      // ignore
    }
    if (!force && last === fp) return
    await this.api.putReminders(reminders)
    try {
      localStorage.setItem(this.lastSentKey, fp)
    } catch {
      // ignore
    }
  }
}
