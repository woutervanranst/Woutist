import { LIMITS } from '@woutist/contracts'
import { endpointKey } from '../lib/keys'
import type { Store, SubscriptionEntity } from '../lib/tables'
import type { SubscriptionInput } from '../lib/validation'

export interface UpsertSubscriptionResult {
  evicted: number
}

/** Stores (or refreshes) a push subscription; beyond the per-user cap the least recently updated ones go. */
export async function upsertSubscription(
  store: Store,
  userKey: string,
  input: SubscriptionInput,
  now: Date,
): Promise<UpsertSubscriptionResult> {
  const rowKey = endpointKey(input.endpoint)
  const timestamp = now.toISOString()
  const existing = await store.subscriptions.get(userKey, rowKey)
  await store.subscriptions.upsert({
    partitionKey: userKey,
    rowKey,
    endpoint: input.endpoint,
    p256dh: input.p256dh,
    auth: input.auth,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  })

  const all = await store.subscriptions.listPartition(userKey)
  const excess = all.length - LIMITS.maxSubscriptionsPerUser
  if (excess <= 0) return { evicted: 0 }
  const victims = all
    .filter((s) => s.rowKey !== rowKey)
    .sort(byUpdatedAt)
    .slice(0, excess)
  for (const victim of victims) {
    await store.subscriptions.delete(userKey, victim.rowKey)
  }
  return { evicted: victims.length }
}

export async function deleteSubscription(store: Store, userKey: string, endpoint: string): Promise<void> {
  await store.subscriptions.delete(userKey, endpointKey(endpoint))
}

function byUpdatedAt(a: SubscriptionEntity, b: SubscriptionEntity): number {
  return a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0
}
