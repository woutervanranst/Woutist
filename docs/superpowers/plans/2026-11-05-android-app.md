# Woutist for Android Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Woutist as an Android app (Capacitor 8) that clones the official To Do Android app. It adds native sign-in, native reminders, background refresh, a home-screen widget, quick add (app shortcut and share-to), and a CI-signed APK.

**Architecture:**
- The React app runs unchanged in Capacitor's WebView. Its Dexie sync engine stays the only full sync.
- **Native auth:** a Kotlin `AuthManager` (MSAL Android, single-account) is shared by the WebView (through the `WoutistAuth` plugin), the widget, the notification actions and the background worker.
- **Snapshot:** after every change, the JS app hands native code a compact snapshot of open tasks (through the `WoutistNative` plugin).
- **Native features read the snapshot:** alarms, the widget and quick add all work from it. Native code calls Graph itself only to complete a task, create a task, or refresh the snapshot in the background.

**Tech Stack:**
- Capacitor 8.6 (`@capacitor/core`, `cli`, `android`, `app`), React 19 / Vite 8 / Vitest 4 (existing).
- Kotlin 2.x, AGP 8.13 / Gradle 8.14 (from the Capacitor template), JDK 21 (Homebrew `openjdk@21`), compileSdk/targetSdk 36, minSdk 24.
- `com.microsoft.identity.client:msal` 8.6.x, `androidx.glance:glance-appwidget` 1.2.x, `androidx.work:work-runtime-ktx` 2.12.x, `com.squareup.okhttp3:okhttp` 5.x, JUnit 4.

**Spec:** `docs/superpowers/specs/2026-11-05-android-app-design.md`

## Global Constraints

- **App ids and names:** release app id `com.wouteronarchitecture.woutist`, name **Woutist**. Debug app id `com.wouteronarchitecture.woutist.debug`, name **Woutist dev**.
- **Graph compatibility:** write only native To Do fields. Snooze is local only and is never written to Graph.
- **Public repo, no secrets in git:** no keystores, passwords, `local.properties` or tokens. Keystore files (`*.jks`, `*.keystore`) are gitignored.
- **Entra app** client id `ef5e6e64-2019-41a7-8b29-35ef15b28c5f`, object id `cf4db39a-6705-4783-a59a-27e7b9d5aa39`, authority `https://login.microsoftonline.com/common`, audience `AzureADandPersonalMicrosoftAccount`.
- **Graph scopes:** `User.Read`, `Tasks.ReadWrite`, `MailboxSettings.ReadWrite` (same as `web/src/auth/scopes.ts`). The native app doesn't call the Woutist reminder API.
- **Personal Microsoft accounts must work.** Work accounts are best-effort; no Intune MAM SDK.
- **Reminder rules are the same as `web/src/services/push/reminders.ts`:**
  - only open tasks with the reminder on and a non-temporary id
  - fire time later than now − 60 s and no more than 90 days ahead
  - sorted by time, at most 1000
- **Brand colour** `#186DB6`. Light/dark follows the system.
- **The owner signs in on the phone.** Claude never types passwords.
- **Test phone:** OnePlus Nord 2 (DN2103), Android 13 / API 33, over adb. Microsoft Authenticator (broker) and the official To Do app are installed.
- **Exact alarms:** use `SCHEDULE_EXACT_ALARM` (never `USE_EXACT_ALARM`), and fall back to inexact alarms when it isn't granted.

## Review Focus

1. **Signed out, or the token can't be refreshed silently while the app is closed.** Expected: a worker or notification action keeps its pending operation and doesn't crash or retry in a loop. The widget shows "Open Woutist to sign in". Pinned in Task 3: `TaskOpWorkerTest.keepsOpWhenSignInNeeded`.
2. **Task completed, deleted or moved elsewhere before its alarm fires or before a widget tick.** Expected: no notification for a task missing from the latest snapshot, and completing a task that's gone (404) quietly drops the operation. Pinned in Task 3: `ReminderDecisionTest.skipsTaskMissingFromSnapshot` and `TaskOpWorkerTest.dropsOpOnNotFound`.
3. **Completing a recurring task from the widget or a notification.** Graph keeps the same id open with the next due date. Expected: the task reappears with its next date after the operation succeeds. It must not stay hidden. Pinned in Task 3: `SnapshotStoreTest.completedOverlayClearsWhenOpSucceeds`.
4. **Time zones and DST.** The phone's zone changes, or a reminder sits across a DST switch (Europe/Brussels, 2026-03-29). Expected: alarms fire at the right wall-clock time, and "today" for Planned quick add is the phone's local date. Pinned in Task 4: `GraphMappingTest.reminderAcrossDstMapsToInstant`. Task 3 adds the `TIMEZONE_CHANGED` reschedule.
5. **Reboot, app update, or the exact-alarm permission revoked.** Expected: all reminders are re-armed without duplicates. Pinned in Task 3: `ReminderSchedulerTest.diffIsIdempotent`, plus receivers for `BOOT_COMPLETED`, `MY_PACKAGE_REPLACED` and `SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED`.

---

## File map

```
web/
  capacitor.config.ts                         Task 1
  android/                                    Task 1 (generated by `cap add android`, then edited)
    app/build.gradle                          debug suffix/name, signing from env, Kotlin, deps
    app/src/main/AndroidManifest.xml          receivers, activities, permissions, share intent
    app/src/main/java/com/wouteronarchitecture/woutist/
      MainActivity.kt                         Task 1/2/3 (registers plugins, forwards launch URLs)
      auth/AuthManager.kt, auth/WoutistAuthPlugin.kt             Task 2
      data/Snapshot.kt, data/SnapshotStore.kt, data/PendingOp.kt Task 3
      data/GraphApi.kt, data/GraphMapping.kt                     Task 3/4
      reminders/ReminderRules.kt, reminders/ReminderScheduler.kt,
        reminders/ReminderReceiver.kt, reminders/NotificationActionReceiver.kt,
        reminders/RescheduleReceiver.kt                          Task 3
      work/TaskOpWorker.kt, work/RefreshWorker.kt                Task 3/4
      bridge/WoutistNativePlugin.kt                              Task 3
      widget/WidgetContent.kt, widget/TaskListWidget.kt,
        widget/TaskListWidgetReceiver.kt, widget/WidgetConfigActivity.kt  Task 5
      quickadd/QuickAddActivity.kt, quickadd/SharedText.kt       Task 6
    app/src/debug/res/raw/msal_config.json, app/src/release/res/raw/msal_config.json  Task 2/7
    app/src/main/res/xml/shortcuts.xml, xml/task_list_widget_info.xml                 Task 5/6
    app/src/test/java/com/wouteronarchitecture/woutist/...       JUnit tests
  src/platform/native.ts                      Task 1: isNative
  src/platform/androidBack.ts                 Task 1: back-button decision + hook
  src/platform/navigation.ts                  Task 3: usePlatformNavigation (SW + native)
  src/auth/nativeAuth.tsx                     Task 2: NativeAuthProvider (AuthAdapter)
  src/native/plugins.ts                       Task 2/3: registerPlugin typings
  src/native/snapshot.ts                      Task 3: buildSnapshot, widgetTasks
  src/native/nativeBridge.ts                  Task 3: pushes snapshots, listens to native events
  src/native/__fixtures__/                    Task 3/5: shared JS↔Kotlin parity fixtures
  src/ui/settings/NativeNotificationSettings.tsx  Task 3
.github/workflows/ci-cd.yml                   Task 7: android-test + android-release jobs
docs/*.md                                     Task 7
```

---

### Task 1: Capacitor shell that runs "Woutist dev" on the phone

**Files:**
- Create: `web/capacitor.config.ts`, `web/src/platform/native.ts`, `web/src/platform/androidBack.ts`, `web/src/platform/androidBack.test.ts`, `web/android/**` (generated)
- Modify: `web/package.json` (deps + scripts `android:sync`, `android:run`), `web/src/App.tsx`, `web/src/ui/shell/AppShell.tsx` (safe-area padding, `useAndroidBack()`), `web/index.html` (`viewport-fit=cover`), `.gitignore`

**Interfaces:**
- Produces:
  - `isNative: boolean` (`web/src/platform/native.ts`, from `Capacitor.isNativePlatform()`)
  - `backAction(state: { hasOpenDialog: boolean; hasTaskParam: boolean; canGoBack: boolean }): 'closeDialog' | 'closeTask' | 'back' | 'exit'`
  - `useAndroidBack(): void`
  - Gradle build types `debug` (suffix `.debug`, `app_name` "Woutist dev") and `release` (signing from env `WOUTIST_KEYSTORE_PATH`, `WOUTIST_KEYSTORE_PASSWORD`, `WOUTIST_KEY_ALIAS`, `WOUTIST_KEY_PASSWORD`, used only when all are set)

- [ ] **Step 1: Install the toolchain (no sudo)**

Run:
- `brew install openjdk@21`
- `sdkmanager --sdk_root=/opt/homebrew/share/android-commandlinetools "platforms;android-36" "build-tools;36.0.0" "platform-tools"`

Expected: `/opt/homebrew/opt/openjdk@21/bin/java -version` prints 21. `web/android/local.properties` (gitignored) will contain `sdk.dir=/opt/homebrew/share/android-commandlinetools`. Builds run with `JAVA_HOME=/opt/homebrew/opt/openjdk@21`.

- [ ] **Step 2: Write the failing test** `web/src/platform/androidBack.test.ts`

```ts
it('closes an open dialog first', () => expect(backAction({ hasOpenDialog: true, hasTaskParam: true, canGoBack: true })).toBe('closeDialog'))
it('then closes the task detail', () => expect(backAction({ hasOpenDialog: false, hasTaskParam: true, canGoBack: true })).toBe('closeTask'))
it('then goes back in history', () => expect(backAction({ hasOpenDialog: false, hasTaskParam: false, canGoBack: true })).toBe('back'))
it('leaves the app at the root', () => expect(backAction({ hasOpenDialog: false, hasTaskParam: false, canGoBack: false })).toBe('exit'))
```

- [ ] **Step 3: Run it and confirm it fails.** `npm test -w @woutist/web -- androidBack` should FAIL (module not found).

- [ ] **Step 4: Implement `backAction` and `useAndroidBack`**
  - `useAndroidBack` listens to `App.addListener('backButton', …)` only when `isNative`.
  - `closeDialog` dispatches an `Escape` keydown on `document.activeElement` (Fluent dialogs close on Escape).
  - `closeTask` removes `?task=` with `replace`.
  - `back` calls `navigate(-1)`. `exit` calls `App.exitApp()`.
  - `hasOpenDialog` is `!!document.querySelector('[role="dialog"]')`.

- [ ] **Step 5: Run the tests and confirm they pass** (all web tests).

- [ ] **Step 6: Add Capacitor**
  - Packages: `@capacitor/core@^8.6.0`, `@capacitor/app` (dependencies) and `@capacitor/cli@^8.6.0`, `@capacitor/android@^8.6.0`, `@capacitor/assets` (devDependencies).
  - `capacitor.config.ts`: `{ appId: 'com.wouteronarchitecture.woutist', appName: 'Woutist', webDir: 'dist' }`.
  - Run `npx cap add android`.
  - Add the Kotlin Android plugin. Convert `MainActivity.java` to `MainActivity.kt`.
  - In `app/build.gradle`: `buildTypes.debug { applicationIdSuffix ".debug"; resValue "string", "app_name", "Woutist dev" }`, `release { resValue "string", "app_name", "Woutist" }`. Remove `app_name` from `strings.xml`.
  - Add the release `signingConfig` from the env vars above.
  - Generate the icon and splash with `npx capacitor-assets generate --android` from `web/public/logo.svg`, background `#186DB6`.
  - Gitignore `web/android/local.properties`, `*.jks`, `*.keystore`, `web/android/app/build/`, `web/android/.gradle/`.

- [ ] **Step 7: Native-only adjustments in the React app**
  - `App.tsx` mounts `<PwaUpdatePrompt />` only when `!isNative`, so no service worker is registered in the app.
  - `AppShell` calls `useAndroidBack()` and pads the root with `env(safe-area-inset-top|bottom|left|right)`.
  - `index.html` viewport gets `viewport-fit=cover`.
  - `NotificationSettings` renders nothing when `isNative`; Task 3 replaces it on native.
  - The keyboard must not cover the add bar: `android:windowSoftInputMode="adjustResize"` on `MainActivity`, with the root sized to `100dvh`.

- [ ] **Step 8: Build and run on the phone**

Run: `npm run build -w @woutist/web && npx cap sync android && (cd web/android && JAVA_HOME=/opt/homebrew/opt/openjdk@21 ./gradlew installDebug) && adb shell am start -n com.wouteronarchitecture.woutist.debug/com.wouteronarchitecture.woutist.MainActivity`

Expected: "Woutist dev" opens with the Woutist sign-in screen. `adb exec-out screencap -p > scratchpad/t1.png` shows it with the status bar not overlapping. Back on the sign-in screen leaves the app. (Sign-in itself comes in Task 2. Task 2, Step 7 also checks that the add bar stays visible above the keyboard.)

- [ ] **Step 9: Run lint, typecheck and tests, then commit** `feat(android): Capacitor shell for Woutist (dev and release variants)`

---

### Task 2: Native sign-in (MSAL Android) behind `AuthAdapter`

**Files:**
- Create:
  - `web/android/app/src/main/java/.../auth/AuthManager.kt` and `auth/WoutistAuthPlugin.kt`
  - `web/android/app/src/debug/res/raw/msal_config.json`
  - `web/src/native/plugins.ts`
  - `web/src/auth/nativeAuth.tsx` and `nativeAuth.test.tsx`
- Modify:
  - `web/src/main.tsx`: when `isNative`, use `NativeAuthProvider`.
  - `web/src/app/AppServices.tsx`: `push` is `null` when `isNative`.
  - `AndroidManifest.xml`: MSAL `BrowserTabActivity` with the debug scheme/host/path via manifest placeholders.
  - `docs/entra-app-registration.md`.

**Interfaces:**
- Produces (Kotlin):
  - `object AuthManager`, with `data class NativeAccount(val key: String, val name: String, val username: String)` where `key = "${account.id}.${account.tenantId}"`:
    - `suspend fun init(context: Context)`
    - `suspend fun account(): NativeAccount?`
    - `suspend fun signIn(activity: Activity, scopes: List<String>): NativeAccount`
    - `suspend fun signOut()`
    - `suspend fun tokenSilent(scopes: List<String>): String` (throws `SignInRequired`)
    - `suspend fun tokenInteractive(activity: Activity, scopes: List<String>): String`
  - `GRAPH_SCOPES` constant mirroring the web.
- Produces (JS, in `web/src/native/plugins.ts`):
  - `WoutistAuth` with `signIn(): Promise<NativeAccount>`, `signOut(): Promise<void>`, `getAccount(): Promise<{ account: NativeAccount | null }>`, `acquireToken(o: { scopes: string[]; interactive: boolean }): Promise<{ accessToken: string }>`
  - It rejects with `code === 'sign_in_required'` when silent acquisition can't succeed.
- Produces: `NativeAuthProvider({ children })` implementing `AuthAdapter`. `getApiToken()` rejects with `'Not used on Android'`.

- [ ] **Step 1: Write the failing tests** `web/src/auth/nativeAuth.test.tsx`, with `WoutistAuth` mocked
  - `graphTokenFallsBackToInteractive`: the first `acquireToken({interactive:false})` rejects with `{code:'sign_in_required'}`. The adapter's Graph token provider then calls `acquireToken({interactive:true})` and returns its `accessToken`.
  - `exposesAccount`: `getAccount` returns `{ key:'oid.tid', name:'W', username:'w@x' }`. `useAuth().account` equals it.
  - `signOutClearsAccount`: after `signOut()`, `account` is `null`.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement `nativeAuth.tsx` and `plugins.ts`.** The Graph client uses the existing `createGraphClient(getToken)`.
- [ ] **Step 4: Run the tests and confirm they pass.**
- [ ] **Step 5: Implement `AuthManager` and `WoutistAuthPlugin`**
  - Single-account `PublicClientApplication` from `R.raw.msal_config`, with `"account_mode": "SINGLE"`, `"broker_redirect_uri_registered": true`, and an authority of type AAD with audience `AzureADandPersonalMicrosoftAccount`.
  - Add the MSAL dependency plus the Microsoft Duo SDK Maven feed if MSAL's display-mask dependency needs it.
  - Register the plugin in `MainActivity` before `super.onCreate`.
- [ ] **Step 6: Register the debug redirect URI**
  - Hash: `keytool -exportcert -alias androiddebugkey -keystore ~/.android/debug.keystore -storepass android | openssl sha1 -binary | openssl base64`
  - Add `msauth://com.wouteronarchitecture.woutist.debug/<url-encoded hash>` to the app's `publicClient.redirectUris` with `az rest --method PATCH` on `/applications/cf4db39a-…`. Keep the existing values.
  - Verify with `az ad app show --id ef5e6e64-… --query publicClient.redirectUris`.
- [ ] **Step 7: Check sign-in on the phone (owner action)**
  - Install the debug build. The owner taps Sign in and completes it (via Authenticator).
  - Expected: lists and tasks appear. `adb logcat -s Woutist` shows no auth errors. Kill and reopen the app: still signed in, with no prompt.
  - Tap the add bar: a screenshot shows it above the keyboard. Press Back with a task open: the detail closes first.
- [ ] **Step 8: Commit** `feat(android): native Microsoft sign-in via MSAL Android`

---

### Task 3: Snapshot bridge, native reminders, notification actions and the native op queue

**Files:**
- Create:
  - JS: `web/src/native/snapshot.ts` and `snapshot.test.ts`, `web/src/native/nativeBridge.ts`, `web/src/native/__fixtures__/snapshot-input.json`, `web/src/native/__fixtures__/reminders-expected.json`, `web/src/platform/navigation.ts`, `web/src/ui/settings/NativeNotificationSettings.tsx`
  - Kotlin: `data/Snapshot.kt`, `data/SnapshotStore.kt`, `data/PendingOp.kt`, `data/GraphApi.kt`, `reminders/*.kt`, `work/TaskOpWorker.kt`, `bridge/WoutistNativePlugin.kt`
  - Kotlin tests: `SnapshotStoreTest`, `ReminderRulesTest`, `ReminderSchedulerTest`, `ReminderDecisionTest`, `TaskOpWorkerTest`
- Modify:
  - `AppServices.tsx`: start and stop `NativeBridge` when `isNative`.
  - `AppShell.tsx`: replace `useServiceWorkerNavigation()` with `usePlatformNavigation()`; render `NativeNotificationSettings` on native.
  - `useInAppReminders.ts`: no system notification when `isNative`.
  - `useSignOut`: call `WoutistNative.clear()` on native.
  - `AndroidManifest.xml`: permissions `POST_NOTIFICATIONS`, `SCHEDULE_EXACT_ALARM`, `RECEIVE_BOOT_COMPLETED`, `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, plus the receivers.
  - `app/build.gradle`: `sourceSets.test.resources.srcDirs += '../../src/native/__fixtures__'`.

**Interfaces:**
- **Snapshot JSON**, the same shape in TS and Kotlin:
  ```
  NativeSnapshot { version: 1, accountKey: string, generatedAt: string, timeZone: string,
    lists: { id, name, wellknownListName }[],
    tasks: { id, listId, title, important: boolean, dueDate: string|null, reminderAt: string|null,
             createdDateTime: string, recurring: boolean }[],
    sort: Record<string /* viewKey */, { key: SortKey; dir: SortDir }> }
  ```
  - Only open tasks with server ids are included.
  - `reminderAt` is set only when the reminder is on (an ISO instant).
- **JS:**
  - `buildSnapshot(input: { accountKey: string; lists: TodoList[]; tasks: Task[]; sort: Prefs['sort']; now: Date; timeZone: string }): NativeSnapshot`
  - `remindersFromSnapshot(s: NativeSnapshot, now: Date): { taskId: string; listId: string; fireAt: string }[]`, which applies the rules from Global Constraints.
  - `class NativeBridge { constructor(services: AppServices, accountKey: string); start(): void; stop(): void }`. It debounces 1 s and pushes on Dexie changes to `lists`/`tasks` and on engine events. It calls `engine.sync()` on the native `changed` event.
  - `usePlatformNavigation(): void` handles service-worker `navigate` messages on the web, and the native `navigate` event plus `consumeLaunchUrl()` on Android.
- **Plugin `WoutistNative`** (JS typings in `plugins.ts`):
  - `setSnapshot({ snapshot }): Promise<void>`
  - `clear(): Promise<void>`
  - `getStatus(): Promise<{ notifications: boolean; exactAlarms: boolean; batteryUnrestricted: boolean }>`
  - `requestNotificationPermission(): Promise<{ granted: boolean }>`
  - `openSystemSettings({ target: 'notifications' | 'exactAlarms' | 'battery' }): Promise<void>`
  - `consumeLaunchUrl(): Promise<{ url: string | null }>`
  - events `changed` and `navigate` (`{ url: string }`)
- **Kotlin:**
  - In `Snapshot.kt`, parsed with `org.json`:
    - `data class Snapshot(val version: Int, val accountKey: String, val generatedAt: String, val timeZone: String, val lists: List<SnapList>, val tasks: List<SnapTask>, val sort: Map<String, SortPref>)`
    - `data class SnapList(val id: String, val name: String, val wellknownListName: String)`
    - `data class SnapTask(val id: String, val listId: String, val title: String, val important: Boolean, val dueDate: String?, val reminderAt: String?, val createdDateTime: String, val recurring: Boolean)`
    - `data class SortPref(val key: String, val dir: String)`
  - `SnapshotStore(context)`:
    - `fun replaceBase(s: Snapshot)`
    - `fun current(): Snapshot?` (the base with pending ops applied: completed ids removed, created tasks appended with ids `native_tmp_<uuid>`)
    - `fun addPending(op: PendingOp)`, `fun removePending(opId: String)`, `fun pending(): List<PendingOp>`, `fun clear()`
    - `var needsSignIn: Boolean`: set by workers on `SignInRequired`, cleared by `replaceBase` from the app
    - `replaceBase` with a **different `accountKey`** drops all pending ops and the armed alarms first, so another account's tasks never show or fire
    - every mutation calls `onChanged` (reschedules alarms; widgets update in Task 5)
  - `sealed class PendingOp(val id: String)` with `Complete(id, listId, taskId)` and `Create(id, listId, title, important: Boolean, dueDate: String?, notes: String?)`
  - `object ReminderRules { fun desired(s: Snapshot, now: Instant): List<Reminder> }`, with `data class Reminder(val taskId: String, val listId: String, val fireAt: Instant)`
  - `ReminderScheduler`:
    - `fun diff(old: Map<String, Instant>, new: List<Reminder>): Pair<List<String> /* cancel */, List<Reminder> /* set */>`
    - `fun sync(context: Context, desired: List<Reminder>)`: exact when `canScheduleExactAlarms()`, otherwise inexact; stores the armed set in SharedPreferences
  - `ReminderReceiver` calls `fun shouldNotify(s: Snapshot?, taskId: String): Boolean` (true only when the task is in `current()`), then posts on channel `reminders`:
    - notification id derived from the task id, title = task title, text = list name
    - actions **Complete** and **Snooze**; a tap opens the app at `/lists/<listId>?task=<taskId>`
  - **Snooze** re-arms a local alarm 10 minutes later (key `snooze:<taskId>`). It's never written to Graph.
  - `GraphApi(tokens: suspend () -> String)`: `completeTask(listId, taskId)` PATCHes `{status:'completed'}`; `createTask(...)` POSTs native fields only (`title`, `importance`, `dueDateTime` with the device zone, `body` as text).
  - `TaskOpWorker` (CoroutineWorker, unique per op id, `NetworkType.CONNECTED`, exponential backoff):
    - success: `removePending` and emit the plugin's `changed` event
    - 404: drop the op
    - `SignInRequired`: `Result.retry()`, keep the op, set the `needsSignIn` flag
    - other 4xx: drop and log
  - `RescheduleReceiver` handles `BOOT_COMPLETED`, `MY_PACKAGE_REPLACED`, `TIMEZONE_CHANGED` and `SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED`, and calls `sync(desired(current()))`.

- [ ] **Step 1: Write the failing JS tests** `snapshot.test.ts`
  - `excludesCompletedAndTempTasks`
  - `reminderAtOnlyWhenOn`
  - `remindersMatchFixture`: `remindersFromSnapshot(fixtureInput, new Date('2026-11-05T08:00:00Z'))` deep-equals `reminders-expected.json`. The fixture covers: a past reminder, one 91 days ahead, a reminder that's off, and two with the same time ordered by `taskId`.
- [ ] **Step 2: Run them and confirm they fail. Implement `snapshot.ts`, then confirm they pass.**
- [ ] **Step 3: Write the failing Kotlin tests**
  - `ReminderRulesTest.matchesSharedFixture`: same files, read from test resources
  - `SnapshotStoreTest`:
    - `pendingCompleteHidesTask`
    - `pendingCreateAppendsTempTask`
    - `completedOverlayClearsWhenOpSucceeds`: after `removePending`, a recurring task in a fresh base with the same id is visible again
    - `replaceBaseKeepsPendingOverlay`
    - `replaceBaseWithOtherAccountDropsPending`
  - `ReminderSchedulerTest`:
    - `diffIsIdempotent`: same input twice gives an empty diff
    - `diffCancelsRemovedAndReArmsChanged`
  - `ReminderDecisionTest.skipsTaskMissingFromSnapshot`
  - `TaskOpWorkerTest`, with a fake `GraphApi`:
    - `dropsOpOnNotFound`
    - `keepsOpWhenSignInNeeded`
    - `removesOpAndSignalsOnSuccess`

  Run: `cd web/android && ./gradlew testDebugUnitTest`. Expected: FAIL.
- [ ] **Step 4: Implement the Kotlin pieces, then run `./gradlew testDebugUnitTest`. Expected: PASS.**
- [ ] **Step 5: Wire the JS side**
  - `NativeBridge` in `AppServices`.
  - `usePlatformNavigation`.
  - `NativeNotificationSettings`:
    - three rows with status and a button each: "Allow notifications", "Allow exact reminders", and "Don't restrict battery (OnePlus)"
    - an explanation that the official app may also notify
  - Request the notification permission once after sign-in.
  - `clear()` on sign-out.
- [ ] **Step 6: Run all web tests, lint and typecheck. Expected: PASS.**
- [ ] **Step 7: Check reminders on the phone end to end**
  1. Install, then set a reminder 2 minutes ahead in Woutist dev.
  2. Swipe the app away and lock the phone.
  3. Expected: `adb shell dumpsys alarm | grep -A2 woutist.debug` lists the alarm, and the notification arrives on time with Complete and Snooze.
  4. Complete it. `adb logcat -s Woutist` shows the PATCH succeeded, and the task is completed in the official app.
  5. Repeat with Snooze and confirm it fires again 10 minutes later.
  6. `adb reboot`, set a reminder 3 minutes ahead before the reboot, and confirm it still fires.
- [ ] **Step 8: Commit** `feat(android): native reminders with Complete/Snooze and an offline op queue`

---

### Task 4: Background refresh

**Files:**
- Create: `data/GraphMapping.kt`, `work/RefreshWorker.kt`, test `GraphMappingTest.kt`, fixture `web/android/app/src/test/resources/graph-tasks-page.json` (synthetic, no real data)
- Modify:
  - `GraphApi.kt`: `fetchSnapshot(...)`
  - `TaskOpWorker.kt`: enqueue a one-time refresh after success
  - `WoutistNativePlugin.kt`: schedule the periodic work on `setSnapshot`, cancel it on `clear`

**Interfaces:**
- `suspend fun GraphApi.fetchSnapshot(accountKey: String, zone: ZoneId, sort: Map<String, SortPref>): Snapshot`
  - `GET /me/todo/lists`
  - per list: `GET /me/todo/lists/{id}/tasks?$filter=status ne 'completed'&$select=id,title,importance,dueDateTime,reminderDateTime,isReminderOn,createdDateTime,recurrence`, following `@odata.nextLink`
  - with `Prefer: outlook.timezone="<zone>"`
- `object GraphMapping { fun task(json: JSONObject, listId: String, zone: ZoneId): SnapTask }`
  - `dueDate` = the date part of `dueDateTime`
  - `reminderAt` = `reminderDateTime` as a local time in `zone` → ISO instant, only when `isReminderOn`
  - `recurring` = `recurrence != null`
- `RefreshWorker`: periodic every 30 min, unique `refresh`, `NetworkType.CONNECTED`. It runs `replaceBase(fetchSnapshot(...))`, keeping `sort` from the stored base. `SignInRequired` → `Result.success()` and sets `needsSignIn`.

- [ ] **Step 1: Verify the filter against live Graph** before relying on it.
  - In the dev web app's console: `await __woutist.graph.api("/me/todo/lists/<id>/tasks?$filter=status ne 'completed'&$top=5").get()`.
  - Expected: 200, with only open tasks. If it errors, drop `$filter` and filter `status != "completed"` while mapping. Record the result in `docs/graph-api-notes.md`.
- [ ] **Step 2: Write the failing tests** `GraphMappingTest`
  - `dueDateIsDatePart`
  - `reminderAcrossDstMapsToInstant`: `2026-03-29T03:30:00` in `Europe/Brussels` → `2026-03-29T01:30:00Z`
  - `reminderIgnoredWhenOff`
  - `recurringFlag`
  - `pageWithNextLinkIsFollowed`, using a fake HTTP layer
- [ ] **Step 3: Run them and confirm they fail. Implement, then confirm they pass** (`./gradlew testDebugUnitTest`).
- [ ] **Step 4: Check background refresh on the phone**
  1. With Woutist dev closed, set a reminder 20 minutes ahead in the official To Do app.
  2. Force the worker: `adb shell cmd jobscheduler run -f com.wouteronarchitecture.woutist.debug <jobId from dumpsys jobscheduler>`.
  3. Expected: `dumpsys alarm` shows the new alarm, and the notification arrives without Woutist being opened.
- [ ] **Step 5: Commit** `feat(android): background refresh schedules reminders set elsewhere`

---

### Task 5: Home-screen widget

**Files:**
- Create:
  - `widget/WidgetContent.kt`, `widget/TaskListWidget.kt`, `widget/TaskListWidgetReceiver.kt`, `widget/WidgetConfigActivity.kt`
  - `res/xml/task_list_widget_info.xml` (resizable, configure = `WidgetConfigActivity`)
  - test `WidgetContentTest.kt`
  - fixture `web/src/native/__fixtures__/widget-expected.json`
- Modify:
  - `web/src/native/snapshot.ts` and its test: `widgetTasks`
  - `SnapshotStore.onChanged`: `TaskListWidget().updateAll(context)`
  - the manifest

**Interfaces:**
- `type WidgetSource = { kind: 'list'; listId: string } | { kind: 'smart'; id: 'important' | 'planned' }`, with the Kotlin equivalent `sealed class WidgetSource`.
- `widgetTasks(s: NativeSnapshot, source: WidgetSource, today: string): SnapTask[]` (JS, the reference) and `WidgetContent.tasks(s, source, today): List<SnapTask>` (Kotlin):
  - **list:** that list's tasks, sorted by `s.sort['list:<id>']` with the same comparators as `sortTasks` (default = `createdDateTime` descending; ties broken by `createdDateTime` descending)
  - **important:** `important` tasks, sorted by `s.sort['smart:important']`
  - **planned:** tasks with a `dueDate`, or with `reminderAt` set; sorted by planned date (`dueDate`, otherwise the local date of `reminderAt`) ascending, then `createdDateTime` descending
- `WidgetContent.title(s, source): String`: list name, "Important" or "Planned".
- Per-widget source is stored in Glance `PreferencesGlanceStateDefinition` under the key `source` (JSON).
- **Configuration screen:** lists Tasks (`defaultList`) first, then Important and Planned, then the other lists in `orderLists` order.
- **Row actions:**
  - checkbox → `CompleteTaskAction` (`addPending(Complete)` + enqueue `TaskOpWorker`)
  - row tap → open the app at the task
  - the header "+" is added in Task 6, together with `QuickAddActivity`
- **Empty and error states:**
  - "Open Woutist to sign in" when there's no snapshot or `needsSignIn` is set
  - "No tasks" when the list is empty

- [ ] **Step 1: Write the failing tests**
  - JS `widgetTasksMatchFixture`: for each of `list:<defaultList>`, `smart:important` and `smart:planned` on `snapshot-input.json` with `today = '2026-11-05'`, deep-equal the ids in `widget-expected.json`.
  - Kotlin `WidgetContentTest.matchesSharedFixture`, against the same files.
  - Kotlin `WidgetContentTest.longTitlesAndEmojiNamesSurvive`: the title is unchanged and the emoji list name keeps its emoji.
- [ ] **Step 2: Run them and confirm they fail. Implement, then confirm both suites pass.**
- [ ] **Step 3: Build the Glance UI**
  - `GlanceTheme` with brand colours in light and dark (`#186DB6` primary).
  - `LazyColumn` rows, each with a `CheckBox`, the title (max 2 lines) and a due-date line (red when overdue).
  - Header with the list name. The "+" comes in Task 6.
- [ ] **Step 4: Check the widget on the phone (owner places it)**
  1. The owner long-presses the home screen → Widgets → Woutist dev, and picks "Tasks".
  2. Expected (`adb exec-out screencap`): the open tasks appear in app order.
  3. Tick one. It disappears, and within a minute it's completed in the official app.
  4. Edit a task in Woutist dev. The widget updates within a few seconds.
- [ ] **Step 5: Commit** `feat(android): home-screen task list widget`

---

### Task 6: Quick add: widget "+", app shortcut and share-to

**Files:**
- Create: `quickadd/QuickAddActivity.kt` (dialog theme, single text field, Add button, Enter submits), `quickadd/SharedText.kt`, test `SharedTextTest.kt`, `res/xml/shortcuts.xml`
- Modify: the manifest (`ACTION_SEND` `text/plain` intent filter on `QuickAddActivity`, static shortcut meta-data on `MainActivity`), and `widget/TaskListWidget.kt` (a header "+" that opens `QuickAddActivity` with that widget's `source`)

**Interfaces:**
- `object SharedText { fun parse(subject: String?, text: String?): Pair<String /* title */, String? /* notes */> }`:
  - **Text with several lines:** the title is the first non-empty line, and the notes are the full text.
  - **A subject plus text containing a URL:** the title is the subject, and the notes are the text.
  - **Only a URL:** the title and the notes are both the URL.
  - **Plain text on a single line:** that line is the title, with no notes.
  - Titles are trimmed to 255 characters.
- `QuickAddActivity` extras: `source` (`WidgetSource` JSON, default `{kind:'list', listId:<defaultList id from snapshot>}`), `subject`, `text`.
- **Submitting a task:**
  - Create the task in the source list. For a smart source, use `defaultList`.
  - From Important, set `important = true`. From Planned, set `dueDate` to today's date in the phone's time zone.
  - Then call `addPending(Create)`, enqueue `TaskOpWorker` and finish the activity.
- **When no snapshot or account is available:** show "Open Woutist to sign in" and disable Add.

- [ ] **Step 1: Write the failing tests** `SharedTextTest`
  - `multilineTextTitleIsFirstLine`
  - `subjectAndUrl`
  - `urlOnly`
  - `singleLine`
  - `longTitleTrimmedTo255`
- [ ] **Step 2: Run them and confirm they fail. Implement, then confirm they pass.**
- [ ] **Step 3: Build the activity, the manifest entries and `shortcuts.xml` ("Add a task").**
- [ ] **Step 4: Check quick add on the phone**
  - **Shortcut:** `adb shell am start -n com.wouteronarchitecture.woutist.debug/com.wouteronarchitecture.woutist.quickadd.QuickAddActivity` opens the dialog over the home screen. Type a title and press Enter, and the task appears in Tasks (in Woutist and the official app).
  - **Share:** `adb shell am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.SUBJECT "Woutist test" --es android.intent.extra.TEXT "https://example.com/x" -n com.wouteronarchitecture.woutist.debug/com.wouteronarchitecture.woutist.quickadd.QuickAddActivity` creates "Woutist test" with the URL in its notes.
  - **Widget:** the widget "+" opens the dialog for that widget's list.
- [ ] **Step 5: Commit** `feat(android): quick add from shortcut, share and widget`

---

### Task 7: Signed release APK in CI, and docs

**Files:**
- Create: `web/android/app/src/release/res/raw/msal_config.json`
- Modify: `.github/workflows/ci-cd.yml`, `docs/deployment.md`, `docs/entra-app-registration.md`, `docs/architecture.md`, `README.md`

**Interfaces:**
- **GitHub `production` environment secrets:** `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
- **Job `android-test`** (push and PR): JDK 21, `npm ci`, `npm run build -w @woutist/web`, `npx cap sync android`, `./gradlew testDebugUnitTest lintDebug`.
- **Job `android-release`:**
  - Runs on a tag push matching `android-v*` (environment `production`).
  - `versionCode = github.run_number`; `versionName` = the tag without the `android-v` prefix.
  - `./gradlew assembleRelease` with the signing env vars from Task 1.
  - Upload `app-release.apk` as `woutist-<versionName>.apk` to the GitHub Release for that tag, via `gh release create`/`upload` with `GITHUB_TOKEN` and `contents: write` on this job only.

- [ ] **Step 1: Create the release key on the Mac, outside the repo**
  - Run `keytool -genkeypair -v -keystore ~/.woutist/woutist-release.jks -alias woutist -keyalg RSA -keysize 4096 -validity 10000` with generated random passwords.
  - Store the passwords in the macOS Keychain (`security add-generic-password -s woutist-android-keystore …`) and never print them.
  - Upload the four secrets with `gh secret set --env production`.
  - Tell the owner to back up the `.jks` file and its passwords (losing them means no more updates to installs signed with it).
- [ ] **Step 2: Register the release redirect URI**
  - Compute the release hash (as in Task 2, from the release keystore).
  - Add `msauth://com.wouteronarchitecture.woutist/<url-encoded hash>` to `publicClient.redirectUris`.
  - Write `src/release/res/raw/msal_config.json`; it contains only public values.
- [ ] **Step 3: Add both CI jobs.** Run gitleaks locally (`gitleaks git --redact .`). Expected: no findings.
- [ ] **Step 4: Push, tag `android-v0.1.0` and watch the run.** `gh run watch`. Expected: `android-release` attaches `woutist-0.1.0.apk` to the release.
- [ ] **Step 5: Install the release APK on the phone next to the dev build (owner action)**
  - `adb install woutist-0.1.0.apk`, or open the release page on the phone.
  - The owner signs in through Authenticator. Expected: "Woutist" and "Woutist dev" are both on the phone, and both are signed in.
- [ ] **Step 6: Docs**
  - `deployment.md`: Android build, install, release, keystore custody and rotation.
  - `entra-app-registration.md`: Android redirect URIs and how to compute a hash.
  - `architecture.md`:
    - replace "Android (next phase)" with the Android design: snapshot, native ops, refresh
    - known limitations: up to three notifications (dev, release, official app); snooze is local; OnePlus battery restrictions; work accounts best-effort
  - `README.md`: installing the APK.
- [ ] **Step 7: Commit** `feat(android): signed release APK from CI, docs`
