import { LIMITS } from '@woutist/contracts'
import { endpointKey } from '../lib/keys'
import type { DeviceEntity, Store } from '../lib/tables'

/** Stores (or refreshes) an FCM token; beyond the per-user cap the least recently updated ones go. */
export async function upsertDevice(store: Store, userKey: string, token: string, now: Date): Promise<void> {
  const rowKey = endpointKey(token)
  const timestamp = now.toISOString()
  const existing = await store.devices.get(userKey, rowKey)
  await store.devices.upsert({
    partitionKey: userKey,
    rowKey,
    token,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  })
  const all = await store.devices.listPartition(userKey)
  const excess = all.length - LIMITS.maxDevicesPerUser
  if (excess <= 0) return
  const victims = all
    .filter((d) => d.rowKey !== rowKey)
    .sort(byUpdatedAt)
    .slice(0, excess)
  for (const victim of victims) await store.devices.delete(userKey, victim.rowKey)
}

export async function deleteDevice(store: Store, userKey: string, token: string): Promise<void> {
  await store.devices.delete(userKey, endpointKey(token))
}

function byUpdatedAt(a: DeviceEntity, b: DeviceEntity): number {
  return a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0
}
