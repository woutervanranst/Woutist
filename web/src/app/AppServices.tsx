import { createContext, type ReactNode, useContext, useEffect, useMemo } from 'react'
import { useAuth } from '../auth/AuthContext'
import { clearPrefs } from './prefs'
import { deleteAccountDb, openAccountDb, type WoutistDb } from '../services/db'
import { TodoRepository } from '../services/repository'
import { SyncEngine } from '../services/sync/syncEngine'
import { TaskService } from '../services/taskService'

export interface AppServices {
  accountKey: string
  db: WoutistDb
  svc: TaskService
  engine: SyncEngine
  repo: TodoRepository
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
    return { accountKey, db, svc, engine, repo }
    // The Graph client only depends on the account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountKey])

  useEffect(() => {
    services.engine.start()
    return () => services.engine.stop()
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
