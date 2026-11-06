# Architecture

## Principle: backward compatible with Microsoft To Do

Microsoft Graph is the **only source of truth**. On tasks, Woutist writes only native To Do fields: title, status, importance, due date, reminder (`isReminderOn` + `reminderDateTime`), recurrence, steps (`checklistItems`), notes (`body`), categories and attachments. Updates are **field-level PATCHes**, so properties Woutist doesn't model are never touched. Stop using Woutist and the official app has everything, including its own reminders.

The one thing Woutist adds is its own settings that follow you to every device (quick dates and reminder times). They're an open extension on the default list, which the official app ignores (see [Settings that follow you](#settings-that-follow-you)).

Everything Woutist keeps for itself is disposable:

| State | Where | Lifetime |
|---|---|---|
| Lists, tasks, steps, attachments, reminders | Microsoft Graph | Permanent; the official app sees it |
| Offline cache + outbox of pending changes | IndexedDB (Dexie), one DB per account: `woutist-<homeAccountId>` | Deleted on sign-out |
| UI preferences (theme, sort, visible smart lists) | `localStorage`, per account | Deleted on sign-out |
| Quick dates, reminder times, reminder rule | `localStorage`, plus an open extension on the default list in Graph | The local copy is deleted on sign-out; the extension stays with the account |
| Push subscriptions, reminder schedule, timer cursor, phones' FCM tokens | Azure Table Storage (Function App's storage account) | Derived from Graph; removable from Settings |
| Change-notification subscriptions (one per list) | Microsoft Graph (`/subscriptions`) | Expire within 3 days unless a Woutist device renews them |

## Web app (`web/`)

```
src/auth/       MSAL.js (redirect flow + v5 redirect bridge page); AuthAdapter seam, MSAL Android on the phone (nativeAuth.tsx)
src/models/     Domain types + Graph mappers, time-zone helpers, smart lists, presets (pure, unit-tested)
src/services/   TaskService (Graph SDK), Dexie DB, repository (optimistic writes + outbox), sync engine, push client
src/ui/         Fluent UI v9 components (shell, sidebar, task list, details, settings)
src/platform/   PWA glue (update/install prompts, service worker messages)
src/sw.ts       Service worker: precache, offline navigation, push + notification clicks
src/dev/        Dev-only: demo mode (?demo) backed by the in-memory fake Graph, Graph console probe
```

### Data flow

1. The UI reads **only from IndexedDB** through live queries (`dexie-react-hooks`), so it works offline and updates instantly.
   - Long lists (search results, Completed, All, big lists) render **50 rows at a time**. More rows load as you scroll near the end, or with *Show more*. Counts always cover everything.
   - **Search** runs once typing pauses (250 ms) or on Enter. It's a substring match over title, notes, steps and categories, so indexes can't help. Instead, each task's text is normalized once and cached per record, which makes a scan of thousands of tasks take milliseconds.
2. User actions go through `TodoRepository`. It applies the change locally and appends an op to the **outbox**, in one transaction.
3. `SyncEngine` pushes the outbox **in order**:
   - New entities have `tmp_` ids. On creation the id is remapped everywhere (rows, queued ops, the URL via `alias:` meta).
   - Network, 429 and 5xx failures back off exponentially.
   - A 404 drops the local entity.
   - Other 4xx responses drop the op and restore the server's version.
4. Pull:
   - Lists are read in full.
   - Tasks use **delta queries** per list. Changed tasks are re-read with `$expand=checklistItems,linkedResources`, because delta doesn't include steps.
   - A full refresh runs on first sync and every 6 hours.
   - **Server data never overwrites an entity with unsynced local changes.**
   - **Categories** are the one exception to the outbox: Settings > Categories (`CategoryService`) writes Outlook master categories straight to Graph, online only, so a failure shows in the dialog. Tasks hold category names as plain strings, so renaming or deleting a category also rewrites the tasks that carry it, and those edits do go through the outbox. Graph won't rename a category: `PATCH displayName` answers success but keeps the old name. So a rename sends the PATCH, trusts it only if the returned name matches, and otherwise creates the new category, re-tags the tasks and deletes the old one. Needs `MailboxSettings.ReadWrite`.
5. Sync runs at start-up, every 5 minutes while visible, on focus and when coming back online, and shortly after each local change. A **sync signal** (see [Near-instant sync](#near-instant-sync)) pulls just the lists it names, within a second or two of the change.

### Dates and reminders

Due date and reminder are **one control**: a date, and optionally a reminder hour on that date. Picking a date applies it at once and keeps the picker open on a row of hour chips; picking an hour (or None) closes it, and a toast says what changed, with Undo. Graph still stores the reminder as its own instant, so:

- Moving the date keeps the reminder's hour, on the new date. Removing the date removes the reminder (and the repeat, like the official app).
- Picking an hour for a task without a date dates it today.
- A reminder on another day than the due date (set elsewhere) is shown with its date, and is moved onto the due date only when you pick a new date or hour.

The picker opens from a task's date chip, its right-click menu (a row of quick-date icons, then hours) and the details pane. On phones it's a bottom sheet. Quick dates, reminder times and whether a date preselects the first reminder time come from Settings.

### Settings that follow you

Quick dates, reminder times and the reminder rule are saved in the Microsoft account (`services/settingsSync.ts`) as an **open extension on the default To Do list** (`com.wouteronarchitecture.woutist.settings`). That needs no permission beyond `Tasks.ReadWrite`, and the official app ignores it. The extension holds the settings as a JSON string plus the time of the last change.

- A change is kept in `localStorage` with its time and marked unsaved, then saved 1.5 s later.
- After every sync the extension is read back. The newer side wins (last writer wins, by the time of the change).
- An unsaved change (offline, or an error) is retried after the next sync.

### Dates and time zones

Reads send `Prefer: outlook.timezone="<browser IANA zone>"`. Due dates are calendar dates (`YYYY-MM-DD`) in the user's zone. Reminders are absolute instants. Writes send local wall time plus the IANA zone. Values written by other clients in other zones (including UTC) are converted correctly.

## Near-instant sync

A change made anywhere (Woutist on another device, the official To Do app, Outlook) reaches every Woutist device in seconds. Graph tells the API, and the API tells the devices to sync. The API still never reads Graph and never sees task content: only list ids pass through.

```
Graph ──change notification──► POST /api/graph-notify/<user>/<v>
                                   │ clientState must be HMAC(secret, user)
                                   ├─► Web PubSub, to the user ──► open web tabs: sync those lists
                                   └─► FCM data message ──────────► phone: background refresh + app sync
```

- **Subscriptions.** Graph only notifies per list (`/me/todo/lists/{id}/tasks`), for at most 4230 minutes. Every device keeps them current after a sync, at most every 12 hours (`graphSubscriptions.ts`):
  - it creates the missing ones, with the URL and `clientState` from `GET /api/graph-hook`;
  - it renews those with less than 36 hours left;
  - it deletes those of lists that are gone (Graph keeps them, verified 2026-11-06).

  Graph is the record, so devices coordinate without a server table. The phone's background refresh renews them too, so they stay alive while only the phone is used.
- **The notification URL** carries the user key and a fingerprint of `GRAPH_HOOK_SECRET`. Rotating the secret therefore changes the URL: devices create new subscriptions, and the old ones (with the old `clientState`) expire unrenewed. Subscriptions of other environments (a dev tunnel, say) have other URLs and are left alone.
- **Web.** While the page is visible, `RealtimeClient` holds a WebSocket to Azure Web PubSub (`GET /api/realtime` returns a URL for the user, which can't publish). Signals within 300 ms are merged into one targeted sync. A dropped connection is retried with backoff, and a full sync follows once it's back. Hidden pages disconnect; they sync when shown again anyway. Polling stays as the safety net.
- **Android.** The app registers its FCM token (`PUT /api/devices`, removed on sign-out or when FCM says it's gone). A high-priority data message starts an expedited `RefreshWorker` run, so the widget and reminder alarms follow even with the app closed. It also tells the running app to sync.
- **The device that made the change** gets the signal too. That costs one delta request that finds nothing.

Latency measured on 2026-11-06 (personal account): changes through Graph arrived 0.4–1.5 s later, and an edit in the official app arrived well within 37 s.

## Reminder push (`api/`)

Graph can't notify a browser at a reminder's time, and SPA refresh tokens can't be used by a server. Woutist therefore runs a small **scheduler that never touches Graph**:

1. After each sync, a device with notifications on sends the full set of upcoming reminders as ids and times only (`PUT /api/reminders`, a reconcile). It also sends its Web Push subscription.
2. A timer function (every minute) sends a Web Push for due reminders.
3. The service worker looks up the task title in IndexedDB and shows the notification. "Complete" opens the app and completes the task there.

Requests carry an access token for `api://<clientId>/Reminders.ReadWrite`. It's validated with `jose` against the Entra JWKS (audience, issuer per tenant, scope, optional allowlist). All data is partitioned by `tid_oid`.

The API runs on a **standalone Flex Consumption Function App**. SWA "bring your own functions" was rejected for four reasons: it needs the Standard plan, doesn't list Flex Consumption, doesn't document whether custom bearer tokens pass through, and the timer works the same either way.

## Known limitations

- Not exposed by Graph: **My Day**, list groups, manual task order, "Assigned to me" (Planner), list sharing management (`isShared` is shown only).
- **Move to another list** is create + delete. The task gets a new id and creation date, and attachments are copied.
- **Duplicate notifications** while the official To Do app is installed next to Woutist (both fire). On a phone with both Woutist builds and the official app, one reminder can notify up to three times (Woutist, Woutist dev, To Do).
- **Official phone app and short-notice reminders.** The official To Do phone app schedules reminders on the phone and fires only those it has synced. Changes made in Microsoft's own apps reach the phone within a minute. Changes made through Graph (Woutist, or any other third-party app) reach it only when it next syncs, for example when it's opened. A reminder set in Woutist one minute ahead does not fire in the official app unless it's opened first; it fires correctly once the app has synced (tested 2026-11-05). Woutist's own push covers this while Woutist is in use.
- **Near-instant sync needs an active device.** Graph subscriptions expire after about 3 days unless a Woutist device (web or phone) renews them. After a longer break, the first sync recreates them; until then, polling covers it.
- Woutist pushes cover reminders that some Woutist device has synced. A task completed elsewhere before that sync can still produce one stale (labelled) notification. The official app's reminders are unaffected.
- Work/school tenants that only allow consent for verified publishers need an admin to approve the app.
- **Brave** turns off Google's push service by default, so turning on reminders fails with "Registration failed - push service error". Fix: turn on *Use Google services for push messaging* in `brave://settings/privacy` and restart Brave. Settings shows this hint.

## Android app (`web/android`)

The same React app runs in a Capacitor 8 shell. Two builds install side by side: **Woutist** (release, `com.wouteronarchitecture.woutist`) and **Woutist dev** (debug, `….debug`). On the phone (`isNative`):

- **Sign-in** is MSAL Android in single-account mode, through Microsoft Authenticator when installed (`WoutistAuth` plugin behind the `AuthAdapter` seam). Graph tokens are silent, with one shared interactive prompt when MSAL needs it.
- **No Web Push.** Reminders are scheduled on the phone instead.

**Snapshot bridge.** After local changes (debounced 1 s) the app pushes a compact snapshot to native code (`WoutistNative.setSnapshot`): lists, open tasks with server ids (title, star, due date, reminder instant, recurring), the tasks completed today (kept apart, with their completion date, for the Today widget), sort preferences, quick dates and reminder times, and whether the outbox still holds unsent changes. Native code keeps it in files (`SnapshotStore`) plus its own **pending operations** (complete, create) made from notifications, the widget or quick add. Its view is the snapshot with those operations applied.

**Reminders.** One alarm per upcoming reminder, with the same rules as Web Push (open tasks, reminder on, from now − 60 s to 90 days ahead, at most 1000; JS and Kotlin are checked against one fixture). They're **alarm-clock alarms** (`setAlarmClock`), like the official app: OxygenOS stretched even exact alarms into a window of 75% of the lead time. Without the exact-alarm permission they fall back to inexact alarms. A notification only appears if the task is still open in the latest snapshot. It offers **Complete** (queued to Graph) and **Snooze** (10 minutes, on the phone only, never written to Graph). Alarms are re-armed after a reboot, an app update, a time-zone change, an exact-alarm permission change, and on every app start (a force-stop clears them).

**Native operations** go to Graph through WorkManager (`TaskOpWorker`, network required, exponential backoff). A 404 drops the operation (the task is gone). "Sign-in required" keeps it and flags the account, and it is retried as soon as the app sends a snapshot again.

**Background refresh.** `RefreshWorker` reads lists, open tasks and tasks completed today from Graph every 30 minutes (Android may stretch this), right after a native operation, and **within seconds of a sync signal** (FCM, as expedited work; on Android 11 and older that shows a quiet "Getting the latest changes" notification while it runs). So reminders set in the official app or on the web get armed while Woutist is closed. Each run also renews the account's Graph subscriptions that are about to expire. It keeps the app's sort preferences and quick dates, and leaves the snapshot alone while the app has unsent changes, or if the app pushed a newer one during the fetch.

**Widget and quick add.** A Glance widget shows a list, Today, Important or Planned in the app's sort order (same rules as `widgetTasks` and `widgetDoneTasks`, checked against a shared fixture). Today lists open tasks due today or earlier (a reminder-only task counts on its reminder's day, as in Planned), then the tasks completed today, ticked and struck through. Ticking completes a task (on Today it moves to the completed rows right away); tapping opens it. The header's refresh arrow runs the background refresh right away (skipped, like the scheduled one, while the app has unsent changes). Its "+", the app icon's **Add a task** shortcut and **Share to Woutist** open a small dialog over the home screen. Like the app, one control sets the date (your quick dates from Settings, or a picked date) and, optionally, a reminder hour on it (your reminder times, or any other time). Quick dates follow the same rules in Kotlin and TypeScript, checked against one fixture. A task added from Important is starred; one added from Today or Planned starts due today.

**Settings** show whether notifications, exact reminders and unrestricted background activity are allowed, with a button for each. A banner asks to fix them while reminders are pending.

### Android limitations

- **Snooze is local.** Other devices and the official app don't know about it.
- **Battery managers (OnePlus and others)** can delay background refresh. Reminders already on the phone fire on time (alarm clocks), but a reminder set elsewhere may only arrive at the next refresh or app start. Allowing background activity helps.
- **Work and school accounts** are best effort: no Intune app protection (MAM) support, and tenants may require admin consent.
- The widget and notifications show what the phone last synced. With sync signals, a change made elsewhere shows within seconds; without them (no Firebase configuration in the build, or FCM delayed by a battery manager), after the next refresh.
