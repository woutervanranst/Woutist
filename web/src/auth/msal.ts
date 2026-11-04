import {
  type AuthenticationResult,
  BrowserCacheLocation,
  type Configuration,
  EventType,
  LogLevel,
  PublicClientApplication,
} from '@azure/msal-browser'
import { config } from '../config'

const bridgeUri = `${window.location.origin}/redirect.html`

export const msalConfig: Configuration = {
  auth: {
    clientId: config.clientId,
    authority: config.authority,
    // MSAL v5: every flow returns through the redirect bridge page.
    redirectUri: bridgeUri,
    // Must also host the bridge and be registered (required for personal accounts).
    postLogoutRedirectUri: bridgeUri,
  },
  cache: {
    // Keeps the installed PWA signed in across launches.
    cacheLocation: BrowserCacheLocation.LocalStorage,
  },
  system: {
    loggerOptions: {
      logLevel: import.meta.env.DEV ? LogLevel.Warning : LogLevel.Error,
      piiLoggingEnabled: false,
      loggerCallback: (level, message, containsPii) => {
        if (containsPii) return
        if (level === LogLevel.Error) console.error(message)
        else if (level === LogLevel.Warning) console.warn(message)
      },
    },
  },
}

export const msalInstance = new PublicClientApplication(msalConfig)

/** Initialize MSAL and pick an active account. Call once before rendering. */
export async function initMsal(): Promise<PublicClientApplication> {
  await msalInstance.initialize()

  if (!msalInstance.getActiveAccount()) {
    const [first] = msalInstance.getAllAccounts()
    if (first) msalInstance.setActiveAccount(first)
  }

  msalInstance.addEventCallback((event) => {
    if (
      (event.eventType === EventType.LOGIN_SUCCESS ||
        event.eventType === EventType.ACQUIRE_TOKEN_SUCCESS) &&
      event.payload
    ) {
      const { account } = event.payload as AuthenticationResult
      if (account && !msalInstance.getActiveAccount()) msalInstance.setActiveAccount(account)
    }
  })

  return msalInstance
}
