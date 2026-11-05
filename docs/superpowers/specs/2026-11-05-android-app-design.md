# Woutist for Android: design

Status: approved (2026-11-05)

## Intent

Woutist already runs on Android as an installed web app (PWA). The owner wants a **real Android app that clones the official Microsoft To Do Android app**, as a base to build on later. A web app can't do the parts that make the official app useful on a phone:

- **native reminders** that fire on time with the app closed
- a **home-screen widget**
- **quick ways to add a task** without opening the app

The screens and the To Do logic stay the ones Woutist already has (React, offline-first, Graph as the source of truth). The Android app wraps them with **Capacitor** (the owner's choice) and adds native pieces where the web can't reach.

## Goals

1. **Same app, on Android.** Everything the web app does (lists, smart lists, tasks, steps, due dates, reminders, repeat, notes, categories, attachments, search, offline edits) works in the Android app, with the existing mobile layout.
2. **Native sign-in.** The user signs in with their Microsoft account through Android's own sign-in (MSAL Android, system browser or the Microsoft Authenticator broker), not a browser tab inside the app. **Personal Microsoft accounts are what must work** (owner's decision). Work/school accounts are best-effort: tenants that require managed apps (Intune app protection) aren't supported, and adding the Intune MAM SDK is out of scope.
3. **Native reminders, like the official app.**
   - Reminders are scheduled **on the phone** and fire at the exact time, even when the app is closed or the phone is idle.
   - The notification shows the task title and its list, and has **Complete** and **Snooze** actions. Complete takes effect in Microsoft To Do without opening the app.
   - Tapping the notification opens the task.
   - Reminders survive a reboot.
   - **Background refresh:** the app checks Graph periodically (about every 15–30 minutes, when online), so reminders set on another device or in the official app get scheduled without opening Woutist.
4. **Home-screen widget**, like the official To Do widget:
   - Shows one list the user picks when placing the widget: Tasks, any user list, or the Important or Planned smart lists.
   - Shows the open tasks in the app's order, each with a checkbox. Ticking one completes the task.
   - Tapping a task opens it in the app.
   - A **"+" bar** at the top adds a task to that list without opening the app. Adding from Important stars the task and adding from Planned makes it due today, the same rules as the app's quick add.
   - Resizable, and follows the system light/dark theme with the Woutist blue (#186DB6).
   - Updates when the app syncs and after background refresh.
5. **Quick add from outside the app:**
   - Long-pressing the app icon offers **"Add a task"**, which opens a small add dialog targeting Tasks.
   - **Share to Woutist** from other apps (text or a link) opens the same dialog, pre-filled. The first line becomes the title, and a link or any longer text goes into the notes.
6. **Android polish:**
   - App icon (adaptive) and splash screen from the Woutist logo.
   - Edge-to-edge layout with correct system-bar insets.
   - The hardware/gesture **Back** closes the detail pane or dialog first, then goes back, then leaves the app.
   - The keyboard doesn't cover the add bar.
   - Settings shows the Android notification and exact-alarm permission status (instead of the web push toggle and "Install app").
7. **Install from the Mac over USB** for day-to-day testing, and **a signed APK built by GitHub Actions** (attached to a GitHub Release) for installing without the Mac.

## Non-goals (for now)

- Google Play Store listing (keep Play's policies in mind, but don't target them yet)
- iOS, Wear OS, tablet-specific layouts
- Firebase / server-sent push for the Android app. Woutist's existing Web Push service stays as it is for browsers.
- Several accounts signed in at the same time. One account at a time, as on the web.
- Re-implementing the whole sync engine natively

## Anti-goals (a failure even if it works)

- **Breaking compatibility with the official app.** As everywhere in Woutist, only native To Do fields are written. A user who stops using Woutist loses nothing. No extensions, no custom data, and no snooze written into Graph.
- **Secrets in the public repo.** The signing keystore, its passwords and any tokens stay in GitHub secrets or on the Mac, never in git.
- **Two sync engines that drift.** The React/Dexie sync engine stays the one full sync. Native code talks to Graph only for the few things it must do while the app isn't running.

## Constraints and context

- **The repo is public** (`woutervanranst/Woutist`). gitleaks runs in CI. See `docs/architecture.md` for the existing design: offline-first IndexedDB cache, outbox, delta sync, the Graph compatibility rules, and the known limitations.
- **Entra app** `Woutist` (client id `ef5e6e64-2019-41a7-8b29-35ef15b28c5f`). Android needs `msauth://com.wouteronarchitecture.woutist/<signature hash>` redirect URIs, one per signing key (debug key on the Mac, release key in CI).
- **App id** `com.wouteronarchitecture.woutist`, display name **Woutist**. These were Claude's calls and the owner accepted them.
- **Debug and release builds sit side by side** (Claude's call). USB/debug builds use the app id `com.wouteronarchitecture.woutist.debug` and the name **"Woutist dev"**. Release builds (CI) use the plain id. So testing never wipes the owner's daily install (sign-in, offline outbox, widgets, alarms). This needs a third Entra redirect URI, for the debug package with the debug key hash. With both builds and the official app installed and signed in, one reminder can fire three times. Documented.
- **Capacitor 8** (currently 8.6). The Android project lives in `web/android/`, and the app bundles the built web assets; it does not load the website remotely.
- **Toolchain on the owner's Mac:** Homebrew Android command-line tools and platform-tools are present (SDK platform 35, build-tools 35). **No JDK yet.** Installing a JDK and any SDK packages Capacitor 8 needs is part of the work.
- **Test device:** the owner's OnePlus Nord 2 (DN2103), Android 13 (API 33), connected over USB (adb). Microsoft Authenticator is installed, so MSAL will use the broker; the broker must be tested with both the debug and the release signature. OxygenOS stops background apps aggressively. Settings should show whether Woutist is exempt from battery optimization and link to the system screen to change it, because reminders and background refresh depend on it. The owner signs in on the phone themselves; Claude never types passwords. The official To Do app is installed on the same phone, so both apps fire for the same reminder. That's the same known limitation as on the web, and it needs documenting.
- **Exact alarms:** on recent Android versions, `SCHEDULE_EXACT_ALARM` isn't granted by default. The app asks the user to allow it (with a clear explanation in Settings) and falls back to inexact alarms when it isn't granted. `USE_EXACT_ALARM` would block a Play listing later, so it isn't used.
- **Same reminder rules as the web.** Which tasks get reminders follows `web/src/services/push/reminders.ts` (`desiredReminders`: open tasks, reminder on, in the future, within the 90-day horizon).

## How it fits together (decided)

- **One codebase for the UI.** The React app detects the native platform and swaps in Android adapters behind interfaces the web app already has or gains:
  - **auth:** `AuthAdapter` in `web/src/auth/AuthContext.tsx` gets a native-MSAL implementation
  - **reminders:** native scheduling instead of Web Push
  - **PWA:** no service worker or install/update prompts in the native app
- **Native MSAL is shared** by the app's UI, the widget, the notification actions and the background worker. They all get Graph tokens from the same signed-in account, so they work without the WebView running.
- **The JS app tells the native side what it knows.** After every sync and every local change, it hands native code a compact snapshot:
  - the lists
  - the open tasks of the lists any widget shows
  - the upcoming reminders

  Native code schedules alarms and redraws widgets from that snapshot.
- **Native code does only a few Graph operations itself:**
  - complete a task (widget checkbox, notification action)
  - add a task (widget "+" bar, quick-add dialog)
  - the background refresh: read lists, open tasks and reminders

  Its writes go to Graph (queued and retried natively when offline). The app picks them up through its normal delta sync the next time it runs.
- **Snooze is local only**, on the phone. It re-fires the notification later and doesn't change the reminder in Microsoft To Do.

## Left to the builder

- Which Capacitor/MSAL bridge to use: an existing plugin (e.g. `@recognizebv/capacitor-plugin-msauth`) or a thin plugin of our own. It must let native widget, worker and notification code share the same account and token cache.
- Widget technology (Jetpack Glance or RemoteViews), its exact look, and the configuration screen.
- Snooze duration and options, the exact notification layout, and the notification channel setup.
- The snapshot format and how JS hands it over. How native offline writes are queued, and how the app learns that native code changed something (so it syncs sooner).
- Background refresh details: interval, constraints, and which Graph queries.
- The share-to and app-shortcut plumbing (plugins or native code), and the quick-add dialog implementation.
- How Back, insets, the splash screen and icons are wired.
- **Tests:**
  - Vitest for the new JS adapters and the reminder/snapshot logic.
  - Kotlin unit tests where the native logic has real decisions in it.
  - End-to-end checks on the USB phone via adb: a reminder fires with the app closed; Complete from the notification; ticking in the widget; the widget "+" bar; share-to; background refresh picking up a reminder set in the official app.
- **The order of work.** Suggested: shell + sign-in → reminders → background refresh → widget → quick add/share → CI-signed APK + docs.
- **CI:**
  - Build the APK in GitHub Actions with the release keystore from GitHub secrets.
  - Publish it as a GitHub Release asset.
  - Register the release key's `msauth://` redirect URI in Entra.
  - Document all of it in `docs/deployment.md` and `docs/entra-app-registration.md`.
