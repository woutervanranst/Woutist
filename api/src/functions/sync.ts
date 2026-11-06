import { app } from '@azure/functions'
import { handleDeleteDevice, handleGetGraphHook, handleGetRealtime, handleGraphNotify, handlePutDevice } from '../handlers/sync'
import { runHttp } from '../lib/runtime'

// Near-instant sync. JWTs are validated in code; graph-notify is called by Graph and checks clientState.
app.http('graphHook', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'graph-hook',
  handler: (request, context) => runHttp(context, (deps) => handleGetGraphHook(request, deps)),
})

app.http('graphNotify', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'graph-notify/{user}/{version}',
  handler: (request, context) => runHttp(context, (deps) => handleGraphNotify(request, deps)),
})

app.http('realtime', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'realtime',
  handler: (request, context) => runHttp(context, (deps) => handleGetRealtime(request, deps)),
})

app.http('devices', {
  methods: ['PUT', 'DELETE'],
  authLevel: 'anonymous',
  route: 'devices',
  handler: (request, context) =>
    runHttp(context, (deps) => (request.method === 'DELETE' ? handleDeleteDevice(request, deps) : handlePutDevice(request, deps))),
})
