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
- creates the `production` environment, which only `main` can deploy to
- creates the `id-woutist-github` identity with a federated credential for the `production` environment (GitHub's immutable-id subject `repo:woutervanranst@<ownerId>/Woutist@<repoId>:environment:production`) and *Website Contributor* on the Function App only
- sets environment secrets (SWA deploy token, OIDC ids) and repository variables (the public `VITE_*` values)
- pushes `main`

From then on, every push to `main` runs `.github/workflows/ci-cd.yml`:
1. lint, typecheck, test and build
2. gitleaks
3. deploy the web app to SWA
4. deploy the API to Functions

Pull requests run the checks only. Fork PRs get no secrets and can't deploy.

### Manual API deploy (without CI)

```bash
npm run build -w @woutist/api
(cd api/deploy && zip -qr ../deploy.zip .)
az functionapp deployment source config-zip -g rg-woutist -n func-woutist --src api/deploy.zip
```

## Rotating the VAPID keys

```bash
node -e "console.log(require('web-push').generateVAPIDKeys())"
az functionapp config appsettings set -g rg-woutist -n func-woutist --settings VAPID_PUBLIC_KEY=<pub> VAPID_PRIVATE_KEY=<priv>
gh variable set VITE_VAPID_PUBLIC_KEY --body <pub>   # then redeploy the web app
```

Existing browser subscriptions are tied to the old key. Users re-enable notifications in Settings.
