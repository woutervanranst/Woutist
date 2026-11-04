/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Entra application (client) id of the Woutist app registration. Public value. */
  readonly VITE_ENTRA_CLIENT_ID: string
  /** Base URL of the reminder push API (Function App), e.g. https://func-woutist.azurewebsites.net/api */
  readonly VITE_API_BASE_URL?: string
  /** VAPID public key for Web Push. Public value. */
  readonly VITE_VAPID_PUBLIC_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** App version from package.json, injected at build time. */
declare const __APP_VERSION__: string
