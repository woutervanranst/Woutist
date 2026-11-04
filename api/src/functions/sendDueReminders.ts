import { app } from '@azure/functions'
import { contextLogger } from '../lib/logger'
import type { PushSender } from '../lib/push'
import { getPushSender, getStore } from '../lib/runtime'
import type { Store } from '../lib/tables'
import { sendDueReminders } from '../services/sendDueReminders'

// Every minute: send Web Push messages for reminders that are due.
app.timer('sendDueReminders', {
  schedule: '0 */1 * * * *',
  runOnStartup: false,
  handler: async (_timer, context) => {
    const log = contextLogger(context)
    let store: Store
    let send: PushSender
    try {
      store = getStore()
      send = getPushSender()
    } catch (err) {
      // Leave the cursor alone: once configured, the timer catches up (up to 24h).
      log.error('sendDueReminders is misconfigured; skipping this run', err)
      return
    }
    const result = await sendDueReminders({ store, send, log, now: () => new Date() })
    if (result.delivered || result.expired || result.stale || result.errors) {
      log.info('sendDueReminders', result)
    }
  },
})
