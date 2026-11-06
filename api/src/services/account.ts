import { forEachLimit } from '../lib/concurrency'
import type { Store } from '../lib/tables'
import { deleteAllReminders } from './reminders'

export interface DeleteUserDataResult {
  subscriptions: number
  devices: number
  reminders: number
}

/** Deletes all of the user's push subscriptions, devices, reminders and schedule rows. */
export async function deleteUserData(store: Store, userKey: string): Promise<DeleteUserDataResult> {
  const subscriptions = await store.subscriptions.listPartition(userKey)
  await forEachLimit(subscriptions, 16, (s) => store.subscriptions.delete(userKey, s.rowKey))
  const devices = await store.devices.listPartition(userKey)
  await forEachLimit(devices, 16, (d) => store.devices.delete(userKey, d.rowKey))
  const reminders = await deleteAllReminders(store, userKey)
  return { subscriptions: subscriptions.length, devices: devices.length, reminders }
}
