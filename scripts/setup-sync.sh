#!/usr/bin/env bash
# One-time setup for near-instant sync (see docs/deployment.md#near-instant-sync):
#   - Azure Web PubSub (Free) for open web tabs, with the Function App's identity as Service Owner
#   - Function App settings: GRAPH_HOOK_SECRET (kept if already set), PUBLIC_API_BASE_URL, WEBPUBSUB_*
#   - Function App CORS: https://localhost, the Android app's origin (without it phones can't register)
#   - optionally FCM_SERVICE_ACCOUNT (Firebase service-account key) and the CI secret with google-services.json
# Idempotent. Requires: az (logged in to the Woutist subscription), gh (for the CI secret), jq, openssl.
#
#   scripts/setup-sync.sh [firebase-service-account.json] [google-services.json]
set -euo pipefail

RG="${RG:-rg-woutist}"
FUNC="${FUNC:-func-woutist}"
PUBSUB="${PUBSUB:-wps-woutist}"
HUB="${HUB:-sync}"
LOCATION="${LOCATION:-westeurope}"
REPO="${REPO:-woutervanranst/Woutist}"
SERVICE_ACCOUNT="${1:-}"
GOOGLE_SERVICES="${2:-}"

az extension add --name webpubsub --upgrade -o none 2>/dev/null || true

echo "==> Resource provider Microsoft.SignalRService (Web PubSub)"
az provider register --namespace Microsoft.SignalRService --wait -o none

echo "==> Web PubSub $PUBSUB (Free_F1)"
if ! az webpubsub show -n "$PUBSUB" -g "$RG" >/dev/null 2>&1; then
  az webpubsub create -n "$PUBSUB" -g "$RG" -l "$LOCATION" --sku Free_F1 -o none
fi
PUBSUB_ID=$(az webpubsub show -n "$PUBSUB" -g "$RG" --query id -o tsv)
PUBSUB_HOST=$(az webpubsub show -n "$PUBSUB" -g "$RG" --query hostName -o tsv)

echo "==> Function App identity may send through $PUBSUB"
PRINCIPAL_ID=$(az functionapp identity show -g "$RG" -n "$FUNC" --query principalId -o tsv)
az role assignment create --assignee-object-id "$PRINCIPAL_ID" --assignee-principal-type ServicePrincipal \
  --role "Web PubSub Service Owner" --scope "$PUBSUB_ID" -o none 2>/dev/null || echo "    (role already assigned)"

echo "==> Function App settings"
# Rotating the secret is safe but makes every device re-create its subscriptions, so keep an existing one.
SECRET=$(az functionapp config appsettings list -g "$RG" -n "$FUNC" \
  --query "[?name=='GRAPH_HOOK_SECRET'].value | [0]" -o tsv)
if [ -z "$SECRET" ]; then SECRET=$(openssl rand -base64 48 | tr -d '\n'); fi
az functionapp config appsettings set -g "$RG" -n "$FUNC" -o none --settings \
  "GRAPH_HOOK_SECRET=$SECRET" \
  "PUBLIC_API_BASE_URL=https://$FUNC.azurewebsites.net" \
  "WEBPUBSUB_ENDPOINT=https://$PUBSUB_HOST" \
  "WEBPUBSUB_HUB=$HUB"

echo "==> Function App CORS allows the Android app (https://localhost)"
# Capacitor serves the web app from https://localhost: without it the phone can't fetch the Graph hook or
# register its FCM token, so it gets no sync signals and only polls.
if [ -z "$(az functionapp cors show -g "$RG" -n "$FUNC" --query "allowedOrigins[?@=='https://localhost'] | [0]" -o tsv)" ]; then
  az functionapp cors add -g "$RG" -n "$FUNC" --allowed-origins https://localhost -o none
fi

if [ -n "$SERVICE_ACCOUNT" ]; then
  echo "==> FCM_SERVICE_ACCOUNT from $SERVICE_ACCOUNT"
  az functionapp config appsettings set -g "$RG" -n "$FUNC" -o none \
    --settings "FCM_SERVICE_ACCOUNT=$(jq -c . "$SERVICE_ACCOUNT")"
fi

if [ -n "$GOOGLE_SERVICES" ]; then
  echo "==> CI secret FIREBASE_GOOGLE_SERVICES_JSON (production environment) from $GOOGLE_SERVICES"
  gh secret set FIREBASE_GOOGLE_SERVICES_JSON --env production --repo "$REPO" < "$GOOGLE_SERVICES"
fi

echo "Done. Web PubSub: wss://$PUBSUB_HOST (allowed by the CSP in web/public/staticwebapp.config.json)."
