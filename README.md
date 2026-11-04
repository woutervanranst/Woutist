# Woutist

A Microsoft To Do client for the web (installable PWA, Android later) built directly on Microsoft Graph.

- **Backward compatible with Microsoft To Do.** Graph is the only source of truth, and Woutist writes only native To Do fields. Stop using Woutist and the official app has everything.
- **Offline-first.** Data is cached in IndexedDB and changes queue in an outbox while offline.
- **Push reminders** come from a small Azure Functions scheduler that never touches Graph.

## Repo layout

| Path | What |
|---|---|
| `web/` | Vite + React + TypeScript SPA (Fluent UI v9, MSAL, Graph SDK, Dexie) |
| `api/` | Azure Functions v4 reminder/push API (Flex Consumption) |
| `packages/contracts/` | DTOs shared by web and api |
| `docs/` | Architecture, Entra registration, Graph notes, deployment |

## Local development

Requires Node 24 (`nvm use`).

```bash
npm install
cp web/.env.example web/.env.local      # public values only
npm run dev                             # http://localhost:5173
```

API (optional, for push): copy `api/local.settings.example.json` to `api/local.settings.json`, start [Azurite](https://learn.microsoft.com/azure/storage/common/storage-use-azurite), then run `npm start -w @woutist/api`.

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

## Docs

- [Entra app registration](docs/entra-app-registration.md)
