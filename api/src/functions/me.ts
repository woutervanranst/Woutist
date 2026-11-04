import { app } from '@azure/functions'
import { handleDeleteMe } from '../handlers/api'
import { runHttp } from '../lib/runtime'

// Deletes everything stored for the caller (subscriptions, reminders, schedule rows).
app.http('me', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'me',
  handler: (request, context) => runHttp(context, (deps) => handleDeleteMe(request, deps)),
})
