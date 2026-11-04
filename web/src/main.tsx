import { MsalProvider } from '@azure/msal-react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { initMsal } from './auth/msal'

async function bootstrap() {
  const msal = await initMsal()
  if (import.meta.env.DEV) await import('./dev/graphProbe')

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <MsalProvider instance={msal}>
        <App />
      </MsalProvider>
    </StrictMode>,
  )
}

void bootstrap()
