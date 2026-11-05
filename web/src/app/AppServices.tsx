import { createContext, type ReactNode, useContext, useEffect, useMemo } from 'react'
import { useAuth } from '../auth/AuthContext'
import { clearPrefs } from './prefs'
import { deleteAccountDb, openAccountDb, type WoutistDb } from '../services/db'
import { TodoRepository } from '../services/repository'
import { SyncEngine } from '../services/sync/syncEngine'
import { TaskService } from '../services/taskService'
import { PushApi } from '../services/push/pushApi'
import { PushController } from '../services/push/pushController'
import { config, pushEnabled } from '../config'
import { isNative } from '../platform/native'
import { NativeBridge } from '../native/nativeBridge'
import { WoutistNative } from '../native/plugins'

export interface AppServices {
  accountKey: string
  db: WoutistDb
  svc: TaskService
  engine: SyncEngine
  repo: TodoRepository
  /** Null when the reminder push service isn't configured for this build. */
  push: PushController | null
  /** The Android app's native side (reminders, widget); null in the browser. */
  native: NativeBridge | null
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
    return { accountKey, db, svc, engine, repo, push, native }
    // The Graph client only depends on the account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountKey])

  useEffect(() => {
    services.engine.start()
    services.push?.start()
    services.native?.start()
    return () => {
      services.native?.stop()
      services.push?.stop()
      services.engine.stop()
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
