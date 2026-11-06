# Deployment

## Azure resources (`rg-woutist`, West Europe)

| Resource | Name | Notes |
|---|---|---|
| Static Web App (Free) | `swa-woutist` | **`https://woutist.wouteronarchitecture.com`** (custom domain; default host `https://proud-moss-0d9caa003.5.azurestaticapps.net` still works); hosts `web/dist` |
| Function App (Flex Consumption, Node 24) | `func-woutist` | `https://func-woutist.azurewebsites.net/api`; system-assigned identity |
| Storage account | `stwoutist5e32d4` | Functions host storage, deployment container `app-package-func-woutist`, Woutist tables |
| Application Insights | `func-woutist` | Function logs |
| User-assigned identity | `id-woutist-github` | GitHub Actions OIDC deploys of the Function App (created by `scripts/setup-github.sh`) |
| Entra app registration | `Woutist` | See [entra-app-registration.md](entra-app-registration.md) |

The Function App reaches storage with **its managed identity** (`AzureWebJobsStorage__accountName`, `TABLES_ENDPOINT`). No storage keys are kept in app settings. The identity has these roles on the storage account: Storage Blob Data Owner, Storage Queue Data Contributor and Storage Table Data Contributor.

### Function App settings

| Setting | Meaning |
|---|---|
| `AzureWebJobsStorage__accountName` | Identity-based host storage |
| `TABLES_ENDPOINT` | `https://<account>.table.core.windows.net` (subscriptions, reminders, schedule, state tables) |
| `ENTRA_CLIENT_ID` | Expected `aud` of incoming access tokens |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Web Push key pair. **The private key exists only here.** |
| `VAPID_SUBJECT` | Contact URL sent to push services (`https://woutist.wouteronarchitecture.com`) |
| `ALLOWED_USERS` | Optional allowlist: comma-separated `tenantId` or `tenantId:objectId` entries. Empty means anyone with a Microsoft account. |

CORS allows only the site's origins (custom domain and default SWA host) and `http://localhost:5173`.

## How it was created

```bash
az group create -n rg-woutist -l westeurope
az staticwebapp create -n swa-woutist -g rg-woutist -l westeurope --sku Free
az storage account create -n <account> -g rg-woutist -l westeurope --sku Standard_LRS --kind StorageV2 \
  --min-tls-version TLS1_2 --allow-blob-public-access false --https-only true
az storage container create --account-name <account> -n app-package-func-woutist   # must exist first
az functionapp create -g rg-woutist -n func-woutist --storage-account <account> \
  --flexconsumption-location westeurope --runtime node --runtime-version 24 \
  --instance-memory 2048 --maximum-instance-count 40 --assign-identity '[system]' \
  --deployment-storage-name <account> --deployment-storage-container-name app-package-func-woutist \
  --deployment-storage-auth-type SystemAssignedIdentity --https-only true
# roles for the function's identity on the storage account
az role assignment create --assignee-object-id <principalId> --assignee-principal-type ServicePrincipal \
  --role "Storage Blob Data Owner" --scope <storageAccountId>   # + Queue Data Contributor, Table Data Contributor
az functionapp config appsettings set -g rg-woutist -n func-woutist --settings \
  AzureWebJobsStorage__accountName=<account> TABLES_ENDPOINT=https://<account>.table.core.windows.net \
  ENTRA_CLIENT_ID=<clientId> VAPID_PUBLIC_KEY=<pub> VAPID_PRIVATE_KEY=<priv> VAPID_SUBJECT=https://<swa-host> ALLOWED_USERS=
az functionapp config appsettings delete -g rg-woutist -n func-woutist --setting-names AzureWebJobsStorage
az functionapp cors add -g rg-woutist -n func-woutist --allowed-origins https://<swa-host> http://localhost:5173
```

## Custom domain

`woutist.wouteronarchitecture.com` (DNS at Hostinger). SWA Free includes the managed TLS certificate.

1. DNS: `CNAME woutist → <default SWA host>` (no CAA record on the zone, or one that allows `digicert.com`).
2. `az staticwebapp hostname set -n swa-woutist -g rg-woutist --hostname <domain> --validation-method cname-delegation`
3. Add `https://<domain>` and `https://<domain>/redirect.html` to the Entra SPA redirect URIs, add `https://<domain>` to the Function App CORS, and set `VAPID_SUBJECT=https://<domain>`.
4. `gh variable set SWA_HOSTNAME --body <domain>` (the deploy job's environment URL).

A new domain is a new browser origin. Sign-in, the offline cache, the installed PWA and push subscriptions don't carry over. Turn off notifications on the old origin first, or each reminder arrives twice.

## GitHub + CI/CD (one-time)

Run `scripts/setup-github.sh` from the repo root. It:
- creates the public repo
- turns on secret scanning and push protection
- creates the `production` environment, which only `v*` release tags can deploy to
- creates the `id-woutist-github` identity with a federated credential for the `production` environment (GitHub's immutable-id subject `repo:woutervanranst@<ownerId>/Woutist@<repoId>:environment:production`) and *Website Contributor* on the Function App only
- sets environment secrets (SWA deploy token, OIDC ids) and repository variables (the public `VITE_*` values)
- pushes `main`

Pushes to `main` and pull requests run the checks only (lint, typecheck, test, build, gitleaks, Android tests and lint). Fork PRs get no secrets and can't deploy.

A release is a pushed tag `v<version>` (see [Releasing](#releasing)). It runs the same checks and then:
1. deploys the web app to SWA
2. deploys the API to Functions
3. builds the signed Android APK and attaches it to the GitHub Release

The version shown in Settings is derived from git: exactly `0.4.0` on the tag build, `0.4.0-5-gabc1234` on builds after it.

### Manual API deploy (without CI)

```bash
npm run build -w @woutist/api
(cd api/deploy && zip -qr ../deploy.zip .)
az functionapp deployment source config-zip -g rg-woutist -n func-woutist --src api/deploy.zip
```

## Releasing

Only tags named `v<version>` release anything. Merging to `main` deploys nothing.

```bash
git tag v0.4.0 && git push origin v0.4.0
```

One tag releases everything: the web app (SWA), the API (Functions) and the signed Android APK (GitHub Release `v0.4.0`), all showing version `0.4.0`.

The `production` environment must allow the tag pattern `v*` (Settings → Environments → production → Deployment branches and tags). `scripts/setup-github.sh` sets this up. For an existing repo, replace the old `main` / `android-v*` rules:

```bash
gh api -X POST repos/<owner>/Woutist/environments/production/deployment-branch-policies -f name='v*' -f type=tag
```

## Android app

**Develop** (JDK 21 at `/opt/homebrew/opt/openjdk@21`, Android SDK path in `web/android/local.properties`, phone with USB debugging):

```bash
npm run android:run -w @woutist/web   # build the web app, sync Capacitor, install and start "Woutist dev"
```

Debug builds also accept `adb shell am broadcast -a com.wouteronarchitecture.woutist.DEBUG_REFRESH -p com.wouteronarchitecture.woutist.debug`, which runs a background refresh now.

**Release.** See [Releasing](#releasing). The `android-release` job (environment `production`) builds the web app, signs `assembleRelease` with the `ANDROID_*` secrets and attaches `woutist-0.2.0.apk` to the GitHub Release `v0.2.0`. `versionCode` is the workflow run number and `versionName` is the tag without `v`. `android-test` (unit tests and lint) runs on every push and PR.

**Install** the APK from the Release page on the phone (allow installs from the browser), or `adb install woutist-0.2.0.apk`. Updates install over it as long as they're signed with the same key.

### Release key custody

| What | Where |
|---|---|
| Keystore (PKCS12, alias `woutist`, RSA 4096, valid 10000 days) | `~/.woutist/woutist-release.jks` on the owner's Mac. Never in git (`*.jks` is ignored) |
| Password (store and key share one) | macOS Keychain, service `woutist-android-keystore`: `security find-generic-password -s woutist-android-keystore -w` |
| CI copy | `production` environment secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` |

**Back it up.** Keep the `.jks` file and its password somewhere outside this Mac, for example as a document in a password manager. GitHub secrets can't be read back. Without the key, no update can be installed over an existing Woutist: everyone would have to uninstall and install a newly signed build. Nothing is lost when that happens, because Graph holds all the data.

Build a signed APK locally:

```bash
cd web/android
export WOUTIST_KEYSTORE_PATH=~/.woutist/woutist-release.jks WOUTIST_KEY_ALIAS=woutist
export WOUTIST_KEYSTORE_PASSWORD="$(security find-generic-password -s woutist-android-keystore -w)" WOUTIST_KEY_PASSWORD="$WOUTIST_KEYSTORE_PASSWORD"
./gradlew assembleRelease
```

**Rotating** the key, only if it leaks:

1. Create a new keystore.
2. Compute its hash and register the new redirect URI (`entra-app-registration.md`).
3. Update `src/release/res/raw/msal_config.json` and `msalSignatureHash` in `app/build.gradle`.
4. Replace the four secrets.

Installed copies must then be uninstalled and reinstalled.

## Rotating the VAPID keys

```bash
node -e "console.log(require('web-push').generateVAPIDKeys())"
az functionapp config appsettings set -g rg-woutist -n func-woutist --settings VAPID_PUBLIC_KEY=<pub> VAPID_PRIVATE_KEY=<priv>
gh variable set VITE_VAPID_PUBLIC_KEY --body <pub>   # then redeploy the web app
```

Existing browser subscriptions are tied to the old key. Users re-enable notifications in Settings.
