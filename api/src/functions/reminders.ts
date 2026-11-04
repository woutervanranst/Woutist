import { app } from '@azure/functions'
import { handlePutReminders } from '../handlers/api'
import { runHttp } from '../lib/runtime'

// Full reconcile of the caller's pending reminders.
app.http('reminders', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'reminders',
  handler: (request, context) => runHttp(context, (deps) => handlePutReminders(request, deps)),
})
