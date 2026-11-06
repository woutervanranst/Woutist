import type { SyncSignal } from '@woutist/contracts'
import type { HandlerDeps } from '../handlers/api'
import { forEachLimit } from '../lib/concurrency'

/**
 * Tells all of the user's devices to sync: open web tabs over the realtime channel, Android devices
 * over FCM. Failures are logged, never thrown; tokens FCM no longer knows (404) are removed.
 */
export async function signalUser(deps: HandlerDeps, userKey: string, signal: SyncSignal): Promise<void> {
  const sync = deps.sync
  if (!sync) return
  const realtime = sync.realtime
    ? sync.realtime.send(userKey, signal).catch((err: unknown) => deps.log.warn('Realtime signal failed', err))
    : Promise.resolve()

  const fcm = sync.fcm
  const devices = fcm
    ? deps.store.devices.listPartition(userKey).then((rows) =>
        forEachLimit(rows, 8, async (device) => {
          const outcome = await fcm(device.token, signal)
          if (outcome.statusCode === 404) {
            await deps.store.devices.delete(userKey, device.rowKey)
          } else if (!outcome.ok) {
            deps.log.warn(`FCM signal failed (${outcome.statusCode ?? 'no status'}): ${outcome.message ?? ''}`)
          }
        }),
      )
    : Promise.resolve()

  await Promise.all([realtime, devices.catch((err: unknown) => deps.log.warn('FCM signals failed', err))])
}
