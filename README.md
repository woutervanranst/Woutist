# Woutist

A Microsoft To Do client for the web (installable PWA) and Android, built directly on Microsoft Graph.

Live at **https://woutist.wouteronarchitecture.com**.

- **Backward compatible with Microsoft To Do.** Graph is the only source of truth, and Woutist writes only native To Do fields on tasks. Stop using Woutist and the official app has everything.
- **Today** gathers what's due or overdue across all lists, plus what you completed today.
- **One control for date and reminder**, with quick dates and reminder hours you set up once in Settings. They follow you to every device.
- **Offline-first.** Data is cached in IndexedDB and changes queue in an outbox while offline.
- **Push reminders** come from a small Azure Functions scheduler that never touches Graph.

## Android

Download `woutist-<version>.apk` from the [latest Android release](https://github.com/woutervanranst/Woutist/releases) on your phone, install it, and sign in with your Microsoft account. You get:

- reminders scheduled on the phone, with Complete and Snooze
- a home-screen task list widget (any list, Today, Important or Planned)
- an "Add a task" shortcut
- Share to Woutist

To build from source, see [deployment](docs/deployment.md#android-app).

## Repo layout

| Path | What |
|---|---|
| `web/` | Vite + React + TypeScript SPA (Fluent UI v9, MSAL, Graph SDK, Dexie) |
| `web/android/` | Capacitor Android app: native sign-in, reminders, widget, quick add (Kotlin) |
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

Demo mode (no sign-in, in-memory fake Graph, dev server only): http://localhost:5173/?demo. Leave it with `?nodemo`. Add `&many=8000` for a long history (8,000 completed and 400 open tasks) to try performance.

## Docs

- [Architecture](docs/architecture.md): data flow, sync, push, where state lives, limitations
- [Deployment](docs/deployment.md): Azure resources, CI/CD, one-time GitHub setup (`scripts/setup-github.sh`)
- [Entra app registration](docs/entra-app-registration.md)
