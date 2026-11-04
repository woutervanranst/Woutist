import { Client, GraphError } from '@microsoft/microsoft-graph-client'

/**
 * Graph client with the SDK's default middleware chain
 * (auth → retry with Retry-After for 429/503/504 → redirect → telemetry → fetch).
 */
export function createGraphClient(getAccessToken: () => Promise<string>): Client {
  return Client.initWithMiddleware({
    authProvider: { getAccessToken },
    defaultVersion: 'v1.0',
  })
}

export function graphStatus(error: unknown): number | null {
  if (error instanceof GraphError) return error.statusCode
  if (error && typeof error === 'object' && 'statusCode' in error) {
    const code = (error as { statusCode: unknown }).statusCode
    return typeof code === 'number' ? code : null
  }
  return null
}

export const isNotFound = (error: unknown) => graphStatus(error) === 404

/** Errors worth retrying later (network, throttling, server). Client errors are not. */
export function isTransient(error: unknown): boolean {
  const status = graphStatus(error)
  if (status === null || status === -1) return true // network failure / offline
  return status === 408 || status === 429 || status >= 500
}
