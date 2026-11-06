import { createContext, type ReactNode, useContext, useEffect, useMemo } from 'react'
import { useAuth } from '../auth/AuthContext'
import { clearPrefs } from './prefs'
import { deleteAccountDb, openAccountDb, type WoutistDb } from '../services/db'
import { CategoryService } from '../services/categoryService'
import { TodoRepository } from '../services/repository'
import { SettingsSync } from '../services/settingsSync'
import { SyncEngine } from '../services/sync/syncEngine'
import { GraphSubscriptions } from '../services/sync/graphSubscriptions'
import { RealtimeClient } from '../services/sync/realtimeClient'
import { SyncSignals } from '../services/sync/syncSignals'
import { TaskService } from '../services/taskService'
import { PushApi } from '../services/push/pushApi'
import { PushController } from '../services/push/pushController'
import { config, pushEnabled } from '../config'
import { isTempId } from '../models/todo'
import { isNative } from '../platform/native'
import { NativeBridge } from '../native/nativeBridge'
import { DeviceRegistration } from '../native/deviceRegistration'
import { WoutistNative } from '../native/plugins'

export interface AppServices {
  accountKey: string
  db: WoutistDb
  svc: TaskService
  engine: SyncEngine
  repo: TodoRepository
  /** Create, recolor, rename and delete Outlook categories. */
  categories: CategoryService
  /** Saves the settings that follow the user (quick dates, reminder times) to their account. */
  settings: SettingsSync
  /** Null when the reminder push service isn't configured for this build. */
  push: PushController | null
  /** Near-instant sync from Graph change notifications; null without the API (or in the demo). */
  signals: SyncSignals | null
  /** The Android app's native side (reminders, widget); null in the browser. */
  native: NativeBridge | null
  /** Registers the phone for sync signals (FCM); null in the browser or without the API. */
  devices: DeviceRegistration | null
}

const AppServicesContext = createContext<AppServices | null>(null)

/** Per-account services: local database, Graph service, sync engine and repository. */
export function AppServicesProvider({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const accountKey = auth.account!.key

  const services = useMemo<AppServices>(() => {
    const db = openAccountDb(accountKey)
    const svc = new TaskService(auth.createGraphClient())
    const engine = new SyncEngine(db, svc)
    const repo = new TodoRepository(db, engine.requestFlush)
    const categories = new CategoryService({ svc, engine, repo, db })
    const settings = new SettingsSync({ db, svc, engine, accountKey })
    // The Android app schedules reminders natively; Web Push is for browsers only.
    const push = pushEnabled && !isNative
      ? new PushController({
          db,
          engine,
          api: new PushApi(config.apiBaseUrl, auth.getApiToken),
          vapidKey: config.vapidPublicKey,
          accountKey,
        })
      : null
    const native = isNative ? new NativeBridge({ db, engine }, accountKey) : null
    // Near-instant sync (not in the demo: its fake Graph can't be subscribed to). Browsers get signals
    // over Web PubSub; the phone over FCM, which native code turns into a `changed` event (a sync).
    const api = config.apiBaseUrl && !accountKey.startsWith('demo') ? new PushApi(config.apiBaseUrl, auth.getApiToken) : null
    const signals = api
      ? new SyncSignals({
          accountKey,
          engine,
          listIds: async () => ((await db.lists.toCollection().primaryKeys()) as string[]).filter((id) => !isTempId(id)),
          subscriptions: new GraphSubscriptions({ svc, getHook: () => api.getGraphHook() }),
          createRealtime: (handlers) =>
            isNative ? { start() {}, stop() {} } : new RealtimeClient({ getUrl: () => api.getRealtimeUrl(), ...handlers }),
        })
      : null
    const devices = api && isNative ? new DeviceRegistration({ accountKey, native: WoutistNative, api }) : null
    return { accountKey, db, svc, engine, repo, categories, settings, push, signals, native, devices }
    // The Graph client only depends on the account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountKey])

  useEffect(() => {
    services.settings.start()
    services.engine.start()
    services.push?.start()
    services.signals?.start()
    services.native?.start()
    // Cheap after the first time: it only calls the API when the FCM token changes.
    const registerDevice = services.devices && services.engine.on((event) => {
      if (event === 'synced') void services.devices?.run()
    })
    void services.devices?.run()
    return () => {
      registerDevice?.()
      services.native?.stop()
      services.signals?.stop()
      services.push?.stop()
      services.engine.stop()
      services.settings.stop()
    }
  }, [services])

  return <AppServicesContext.Provider value={services}>{children}</AppServicesContext.Provider>
}

export function useServices(): AppServices {
  const ctx = useContext(AppServicesContext)
  if (!ctx) throw new Error('useServices must be used inside AppServicesProvider')
  return ctx
}

type SignOutHook = (services: AppServices) => Promise<void>
const signOutHooks = new Set<SignOutHook>()

/** Register cleanup that must run before signing out (e.g. removing push subscriptions). */
export function onBeforeSignOut(hook: SignOutHook): () => void {
  signOutHooks.add(hook)
  return () => signOutHooks.delete(hook)
}

/** Sign out and remove everything Woutist stored on this device for the account. */
export function useSignOut(): () => Promise<void> {
  const services = useServices()
  const { signOut } = useAuth()
  return async () => {
    services.engine.stop()
    services.settings.stop()
    services.signals?.stop()
    // This phone stops receiving the account's sync signals.
    await services.devices?.unregister().catch(() => {})
    // This device stops receiving this account's reminders (other devices are unaffected).
    await services.push?.disable().catch(() => {})
    // The phone forgets the account too: no more alarms, widget data or queued changes.
    services.native?.stop()
    if (services.native) await WoutistNative.clear().catch((error) => console.warn('Clearing native data failed', error))
    for (const hook of signOutHooks) {
      try {
        await hook(services)
      } catch (error) {
        console.warn('Sign-out cleanup failed', error)
      }
    }
    services.db.close()
    await deleteAccountDb(services.accountKey).catch(() => {})
    clearPrefs(services.accountKey)
    await signOut()
  }
}
