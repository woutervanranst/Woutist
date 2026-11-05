# Entra app registration: Woutist

One registration serves every platform (web SPA, PWA, and the Android wrapper later). It's also the audience for Woutist's own reminder API.

| Item | Value |
|---|---|
| Display name | `Woutist` |
| Application (client) ID | `ef5e6e64-2019-41a7-8b29-35ef15b28c5f` |
| Object ID | `cf4db39a-6705-4783-a59a-27e7b9d5aa39` |
| Home tenant | `76640f38-1272-45c1-8df4-8b380fe8e087` |
| Supported accounts | `AzureADandPersonalMicrosoftAccount` (any work/school or personal Microsoft account) |
| Authority | `https://login.microsoftonline.com/common` |
| Access token version | v2 |
| Application ID URI | `api://ef5e6e64-2019-41a7-8b29-35ef15b28c5f` |
| Secrets / certificates | None. The SPA is a public client using auth code + PKCE. |

The client ID and tenant ID aren't secrets; they end up in the JavaScript bundle anyway.

## Redirect URIs (platform: Single-page application)

- `http://localhost:5173` and `http://localhost:5173/redirect.html`, for local dev with Vite
- `https://woutist.wouteronarchitecture.com` and `https://woutist.wouteronarchitecture.com/redirect.html` (production, custom domain)
- `https://proud-moss-0d9caa003.5.azurestaticapps.net` and `https://proud-moss-0d9caa003.5.azurestaticapps.net/redirect.html` (production, default `swa-woutist` host)

`/redirect.html` is a blank page that MSAL uses as the `redirectUri` for popup and silent token requests.

## Permissions (delegated)

| API | Scope | Why |
|---|---|---|
| Microsoft Graph | `Tasks.ReadWrite` | Read and write To Do lists, tasks, steps and attachments |
| Microsoft Graph | `User.Read` | Profile and photo |
| Microsoft Graph | `MailboxSettings.Read` | Outlook master categories (names and colors) |
| Microsoft Graph | `openid`, `profile`, `offline_access` | Sign-in and refresh tokens |
| Woutist (this app) | `api://ef5e6e64-2019-41a7-8b29-35ef15b28c5f/Reminders.ReadWrite` | Calls to the Woutist reminder/push API |

None of these scopes needs admin consent, so users consent on first sign-in. The login request includes the Woutist API scope through `extraScopesToConsent`, so one consent prompt covers everything.

**Work/school accounts in other tenants:** a tenant that only allows user consent for apps from *verified publishers* blocks self-consent. An admin of that tenant then has to grant consent for Woutist.

## Commands for later

```bash
APPID=ef5e6e64-2019-41a7-8b29-35ef15b28c5f
OBJ=cf4db39a-6705-4783-a59a-27e7b9d5aa39

# Replace the SPA redirect URIs (PATCH replaces the whole list, so always send every URI)
az rest --method PATCH --uri "https://graph.microsoft.com/v1.0/applications/$OBJ" \
  --headers Content-Type=application/json \
  --body '{"spa":{"redirectUris":["http://localhost:5173","http://localhost:5173/redirect.html","https://<swa-host>","https://<swa-host>/redirect.html"]}}'

# Android (Capacitor + MSAL Android/broker): add a public-client redirect
#   msauth://<android-package-name>/<url-encoded-base64-signature-hash>
az ad app update --id $APPID --public-client-redirect-uris "msauth://<package>/<hash>"

# Add another Graph delegated scope, e.g. Tasks.ReadWrite.Shared (c5ddf11b-c114-4886-8558-8a4e557cd52b)
az ad app permission add --id $APPID --api 00000003-0000-0000-c000-000000000000 \
  --api-permissions c5ddf11b-c114-4886-8558-8a4e557cd52b=Scope

# Inspect
az ad app show --id $APPID --query "{aud:signInAudience,spa:spa.redirectUris,uris:identifierUris,scopes:api.oauth2PermissionScopes[].value}"
```
