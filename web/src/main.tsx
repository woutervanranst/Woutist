import { StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { MsalAuthProvider, StaticAuthProvider } from './auth/AuthContext'

async function bootstrap() {
  let auth: ReactNode

  if (import.meta.env.DEV && (await import('./dev/demo')).isDemoRequested()) {
    const { createDemoAuth } = await import('./dev/demo')
    auth = (
      <StaticAuthProvider adapter={createDemoAuth()}>
        <App />
      </StaticAuthProvider>
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
