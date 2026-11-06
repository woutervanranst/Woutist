import type { Subscription } from '@microsoft/microsoft-graph-types'
import type { GraphHookResponse } from '@woutist/contracts'
import { isNotFound } from '../graphClient'
import type { TaskService } from '../taskService'

/** Graph allows at most 4230 minutes for todoTask subscriptions; stay a little under for clock skew. */
export const SUBSCRIPTION_MINUTES = 4200
/** Renew when less than this is left, so a device that runs every 12 hours never lets one lapse. */
const RENEW_WITHIN_MS = 36 * 60 * 60 * 1000

export interface EnsureResult {
  created: number
  renewed: number
  deleted: number
  failed: number
}

/** The list id in a subscription's resource: `/me/todo/lists/<encoded id>/tasks` (or Graph's `lists('<id>')`). */
export function listIdOfResource(resource: string | null | undefined): string | undefined {
  if (!resource) return undefined
  const quoted = /lists\('([^']+)'\)/.exec(resource)?.[1]
  if (quoted) return quoted
  const path = /lists\/([^/]+)\/tasks/.exec(resource)?.[1]
  if (!path) return undefined
  try {
    return decodeURIComponent(path)
  } catch {
    return undefined
  }
}

/**
 * Keeps one Graph change-notification subscription per To Do list, pointing at the Woutist API.
 * Graph is the record of what exists, so every device can run this: it creates what's missing, renews
 * what is about to expire and deletes subscriptions of lists that are gone (Graph keeps those). Only
 * subscriptions for this API's notification URL are touched, so other environments are left alone.
 */
export class GraphSubscriptions {
  private readonly svc: TaskService
  private readonly getHook: () => Promise<GraphHookResponse>
  private readonly now: () => number

  constructor(opts: { svc: TaskService; getHook: () => Promise<GraphHookResponse>; now?: () => number }) {
    this.svc = opts.svc
    this.getHook = opts.getHook
    this.now = opts.now ?? Date.now
  }

  async ensure(listIds: readonly string[]): Promise<EnsureResult> {
    const hook = await this.getHook()
    const result: EnsureResult = { created: 0, renewed: 0, deleted: 0, failed: 0 }
    const now = this.now()
    const expiration = new Date(now + SUBSCRIPTION_MINUTES * 60_000).toISOString()
    const expiresAt = (s: Subscription) => Date.parse(s.expirationDateTime ?? '') || 0

    const mine = (await this.svc.listSubscriptions())
      .filter((s) => s.notificationUrl === hook.notificationUrl)
      .sort((a, b) => expiresAt(b) - expiresAt(a))
    const wanted = new Set(listIds)
    const kept = new Map<string, Subscription>()
    const stale: Subscription[] = []
    for (const sub of mine) {
      const listId = listIdOfResource(sub.resource)
      if (listId && wanted.has(listId) && !kept.has(listId) && expiresAt(sub) > now) kept.set(listId, sub)
      else stale.push(sub)
    }

    const attempt = async (fn: () => Promise<void>, counter: keyof EnsureResult) => {
      try {
        await fn()
        result[counter]++
      } catch (error) {
        result.failed++
        console.warn('Graph subscription update failed', error)
      }
    }
    const create = (listId: string) =>
      this.svc
        .createSubscription({
          changeType: 'created,updated,deleted',
          notificationUrl: hook.notificationUrl,
          resource: `/me/todo/lists/${encodeURIComponent(listId)}/tasks`,
          expirationDateTime: expiration,
          clientState: hook.clientState,
        })
        .then(() => undefined)

    for (const sub of stale) {
      await attempt(async () => {
        try {
          await this.svc.deleteSubscription(sub.id!)
        } catch (error) {
          if (!isNotFound(error)) throw error
        }
      }, 'deleted')
    }
    for (const listId of wanted) {
      const sub = kept.get(listId)
      if (!sub) {
        await attempt(() => create(listId), 'created')
      } else if (expiresAt(sub) - now < RENEW_WITHIN_MS) {
        await attempt(async () => {
          try {
            await this.svc.renewSubscription(sub.id!, expiration)
          } catch (error) {
            // Graph removed it in the meantime: start a new one.
            if (!isNotFound(error)) throw error
            await create(listId)
          }
        }, 'renewed')
      }
    }
    return result
  }
}
