/// <reference lib="webworker" />
import type { ReminderPushPayload } from '@woutist/contracts'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

declare let self: ServiceWorkerGlobalScope

// App shell: precached so the app opens offline. Task data lives in IndexedDB, not here.
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('index.html'), {
    // The MSAL redirect bridge must always come from the network (it carries the auth response).
    denylist: [/^\/redirect\.html/],
  }),
)

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting()
})

// ---------- reminders (Web Push) ----------

interface CachedTask {
  id: string
  listId: string
  title: string
  completed: 0 | 1
}

/** Find the task in any Woutist account database (the server only sends ids). */
async function findTask(taskId: string): Promise<CachedTask | null> {
  const dbs = (await indexedDB.databases?.()) ?? []
  for (const info of dbs) {
    if (!info.name?.startsWith('woutist-')) continue
    const task = await new Promise<CachedTask | null>((resolve) => {
      const open = indexedDB.open(info.name!)
      open.onerror = () => resolve(null)
      open.onsuccess = () => {
        const db = open.result
        try {
          if (!db.objectStoreNames.contains('tasks')) return resolve(null)
          const get = db.transaction('tasks', 'readonly').objectStore('tasks').get(taskId)
          get.onsuccess = () => resolve((get.result as CachedTask | undefined) ?? null)
          get.onerror = () => resolve(null)
        } finally {
          db.close()
        }
      }
    })
    if (task) return task
  }
  return null
}

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      let payload: ReminderPushPayload | null = null
      try {
        payload = event.data?.json() as ReminderPushPayload
      } catch {
        payload = null
      }
      if (payload?.type !== 'reminder') {
        await self.registration.showNotification('Woutist', { body: 'You have a reminder.' })
        return
      }
      const task = await findTask(payload.taskId)
      // A notification must be shown for every push; a stale one is labelled rather than hidden.
      const title = task?.title || 'Reminder'
      const body = task?.completed ? 'Reminder (already completed)' : 'Reminder'
      await self.registration.showNotification(title, {
        body,
        tag: `reminder:${payload.taskId}`,
        icon: '/pwa-192x192.png',
        badge: '/pwa-64x64.png',
        data: { taskId: payload.taskId, listId: payload.listId },
        actions: task?.completed
          ? []
          : [
              { action: 'complete', title: 'Complete' },
              { action: 'open', title: 'Open' },
            ],
      } as NotificationOptions)
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const { taskId, listId } = (event.notification.data ?? {}) as { taskId?: string; listId?: string }
  const params = new URLSearchParams()
  if (taskId) params.set('task', taskId)
  if (event.action === 'complete') params.set('complete', '1')
  const url = listId ? `/lists/${encodeURIComponent(listId)}?${params}` : '/'
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const existing = windows.find((w) => new URL(w.url).origin === self.location.origin)
      if (existing) {
        await existing.focus()
        existing.postMessage({ type: 'navigate', url })
        return
      }
      await self.clients.openWindow(url)
    })(),
  )
})
