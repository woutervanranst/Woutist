import { app } from '@azure/functions'
import { handleDeleteSubscription, handlePutSubscription } from '../handlers/api'
import { runHttp } from '../lib/runtime'

// PUT registers/refreshes a push subscription, DELETE removes one. The JWT is validated in code.
app.http('subscription', {
  methods: ['PUT', 'DELETE'],
  authLevel: 'anonymous',
  route: 'subscription',
  handler: (request, context) =>
    runHttp(context, (deps) =>
      request.method === 'DELETE' ? handleDeleteSubscription(request, deps) : handlePutSubscription(request, deps),
    ),
})
