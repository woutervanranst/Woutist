import { API_SCOPE_NAME } from '@woutist/contracts'
import { config } from '../config'

/** Delegated Microsoft Graph scopes Woutist needs. */
export const GRAPH_SCOPES = ['User.Read', 'Tasks.ReadWrite', 'MailboxSettings.Read']

/** Scope for Woutist's own reminder push API (exposed by the same app registration). */
export const API_SCOPES = [`api://${config.clientId}/${API_SCOPE_NAME}`]

/**
 * Sign-in request. A token can only target one resource, so Graph scopes are requested here
 * and the API scope is added to the same consent prompt via extraScopesToConsent.
 */
export const LOGIN_REQUEST = {
  scopes: ['openid', 'profile', 'offline_access', ...GRAPH_SCOPES],
  extraScopesToConsent: API_SCOPES,
}
