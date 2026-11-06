// Realtime channel to open web tabs: Azure Web PubSub, addressed by user. Clients only receive.
import type { TokenCredential } from '@azure/identity'
import { WebPubSubServiceClient } from '@azure/web-pubsub'
import type { SyncSignal } from '@woutist/contracts'

export interface RealtimeChannel {
  /** Delivers the signal to every open connection of the user. */
  send(userKey: string, signal: SyncSignal): Promise<void>
  /** A `wss://` URL whose connection belongs to the user (and may not publish). */
  clientUrl(userKey: string): Promise<string>
}

/** Connections are re-negotiated by the client when they drop; an hour is plenty. */
const CLIENT_TOKEN_MINUTES = 60

export type WebPubSubSettings =
  | { connectionString: string; hub: string }
  | { endpoint: string; credential: TokenCredential; hub: string }

/** Production uses the endpoint with the Function App's managed identity; local development a connection string. */
export function createWebPubSubChannel(settings: WebPubSubSettings): RealtimeChannel {
  const client =
    'connectionString' in settings
      ? new WebPubSubServiceClient(settings.connectionString, settings.hub)
      : new WebPubSubServiceClient(settings.endpoint, settings.credential, settings.hub)
  return {
    send: async (userKey, signal) => {
      await client.sendToUser(userKey, signal)
    },
    clientUrl: async (userKey) => {
      const { url } = await client.getClientAccessToken({ userId: userKey, expirationTimeInMinutes: CLIENT_TOKEN_MINUTES })
      return url
    },
  }
}
