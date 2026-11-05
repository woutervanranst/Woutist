import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { MsalAuthProvider, StaticAuthProvider } from './auth/AuthContext'

async function bootstrap() {
  let auth: ReactNode

  if (import.meta.env.DEV && (await import('./dev/demo')).isDemoRequested()) {
    const { createDemoAuth } = await import('./dev/demo')
    // The fake Graph is re-seeded on every load, so the local cache must start empty too.
    const { deleteAccountDb } = await import('./services/db')
    const adapter = createDemoAuth()
    await deleteAccountDb(adapter.account!.key)
    auth = (
      <StaticAuthProvider adapter={adapter}>
        <App />
      </StaticAuthProvider>
    )
  } else if ((await import('./platform/native')).isNative) {
    // Android app: native MSAL (system browser / Authenticator), not MSAL.js redirects.
    const { NativeAuthProvider } = await import('./auth/nativeAuth')
    auth = (
      <NativeAuthProvider>
        <App />
      </NativeAuthProvider>
    )
  } else {
    const { initMsal } = await import('./auth/msal')
    const msal = await initMsal()
    if (import.meta.env.DEV) await import('./dev/graphProbe')
    auth = (
      <MsalAuthProvider instance={msal}>
        <App />
      </MsalAuthProvider>
    )
  }

  createRoot(document.getElementById('root')!).render(<StrictMode>{auth}</StrictMode>)
}

void bootstrap()
