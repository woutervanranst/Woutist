#!/usr/bin/env bash
# One-time setup: public GitHub repo, deploy identity (OIDC, no stored Azure credentials),
# secrets/variables for CI/CD, then the first push. Idempotent where possible.
# Requires: gh (logged in), az (logged in to the Woutist subscription), run from the repo root.
set -euo pipefail

OWNER="${OWNER:-woutervanranst}"
REPO="${REPO:-Woutist}"
RG="${RG:-rg-woutist}"
SWA="${SWA:-swa-woutist}"
FUNC="${FUNC:-func-woutist}"
IDENTITY="${IDENTITY:-id-woutist-github}"
SITE_HOST="${SITE_HOST:-woutist.wouteronarchitecture.com}" # custom domain; set SITE_HOST= to use the default SWA host
CLIENT_ID_APP="ef5e6e64-2019-41a7-8b29-35ef15b28c5f" # Entra app registration (public value)
FULL="$OWNER/$REPO"

echo "==> GitHub repository $FULL (public)"
if ! gh repo view "$FULL" >/dev/null 2>&1; then
  gh repo create "$FULL" --public --source . --remote origin \
    --description "Woutist: a Microsoft To Do client (web/PWA) on Microsoft Graph"
fi
git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$FULL.git"

echo "==> Secret scanning + push protection"
gh api -X PATCH "repos/$FULL" \
  -f 'security_and_analysis[secret_scanning][status]=enabled' \
  -f 'security_and_analysis[secret_scanning_push_protection][status]=enabled' >/dev/null

echo "==> 'production' environment (deployments from main only)"
gh api -X PUT "repos/$FULL/environments/production" --input - >/dev/null <<'JSON'
{ "deployment_branch_policy": { "protected_branches": false, "custom_branch_policies": true } }
JSON
gh api -X POST "repos/$FULL/environments/production/deployment-branch-policies" \
  -f name=main -f type=branch >/dev/null 2>&1 || true

echo "==> Deploy identity $IDENTITY with federated credential for environment:production"
az identity create -g "$RG" -n "$IDENTITY" -l westeurope -o none
IDENTITY_CLIENT_ID=$(az identity show -g "$RG" -n "$IDENTITY" --query clientId -o tsv)
IDENTITY_PRINCIPAL_ID=$(az identity show -g "$RG" -n "$IDENTITY" --query principalId -o tsv)
# GitHub issues OIDC subjects with immutable owner/repo ids for new repos, e.g.
# repo:owner@123/name@456:environment:production (survives renames; can't be squatted).
SUBJECT=$(gh api "repos/$FULL" --jq '"repo:\(.owner.login)@\(.owner.id)/\(.name)@\(.id):environment:production"')
if az identity federated-credential show -g "$RG" --identity-name "$IDENTITY" -n github-production >/dev/null 2>&1; then
  CMD=update
else
  CMD=create
fi
az identity federated-credential $CMD -g "$RG" --identity-name "$IDENTITY" -n github-production \
  --issuer https://token.actions.githubusercontent.com --subject "$SUBJECT" \
  --audiences api://AzureADTokenExchange -o none
FUNC_ID=$(az functionapp show -g "$RG" -n "$FUNC" --query id -o tsv)
for attempt in 1 2 3 4 5 6; do
  if az role assignment create --assignee-object-id "$IDENTITY_PRINCIPAL_ID" --assignee-principal-type ServicePrincipal \
    --role "Website Contributor" --scope "$FUNC_ID" -o none 2>/dev/null; then break; fi
  echo "   waiting for the identity to replicate ($attempt)…"; sleep 10
done

echo "==> Environment secrets"
gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN --env production --repo "$FULL" \
  --body "$(az staticwebapp secrets list -n "$SWA" -g "$RG" --query properties.apiKey -o tsv)"
gh secret set AZURE_CLIENT_ID --env production --repo "$FULL" --body "$IDENTITY_CLIENT_ID"
gh secret set AZURE_TENANT_ID --env production --repo "$FULL" --body "$(az account show --query tenantId -o tsv)"
gh secret set AZURE_SUBSCRIPTION_ID --env production --repo "$FULL" --body "$(az account show --query id -o tsv)"

echo "==> Repository variables (public build-time values)"
gh variable set VITE_ENTRA_CLIENT_ID --repo "$FULL" --body "$CLIENT_ID_APP"
gh variable set VITE_API_BASE_URL --repo "$FULL" --body "https://$FUNC.azurewebsites.net/api"
gh variable set VITE_VAPID_PUBLIC_KEY --repo "$FULL" \
  --body "$(az functionapp config appsettings list -g "$RG" -n "$FUNC" --query "[?name=='VAPID_PUBLIC_KEY'].value | [0]" -o tsv)"
gh variable set SWA_HOSTNAME --repo "$FULL" \
  --body "${SITE_HOST:-$(az staticwebapp show -n "$SWA" -g "$RG" --query defaultHostname -o tsv)}"

echo "==> Push main (starts CI/CD)"
git push -u origin main

echo "Done: https://github.com/$FULL/actions"
