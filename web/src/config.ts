function required(name: keyof ImportMetaEnv): string {
  const value = import.meta.env[name]
  if (!value) {
    throw new Error(`Missing ${name}. Copy web/.env.example to web/.env.local and fill it in.`)
  }
  return value
}

export const config = {
  clientId: required('VITE_ENTRA_CLIENT_ID'),
  authority: 'https://login.microsoftonline.com/common',
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? '',
  vapidPublicKey: import.meta.env.VITE_VAPID_PUBLIC_KEY ?? '',
} as const

export const pushEnabled = Boolean(config.apiBaseUrl && config.vapidPublicKey)
