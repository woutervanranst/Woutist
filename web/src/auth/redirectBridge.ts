import { broadcastResponseToMainFrame } from '@azure/msal-browser/redirect-bridge'

broadcastResponseToMainFrame().catch((error: unknown) => {
  console.error('MSAL redirect bridge failed', error)
})
