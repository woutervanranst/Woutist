# Microsoft Graph To Do API: verified behaviour

Checked against the live API (v1.0) with a personal Microsoft account on 2026-11-04. You can re-run the spike from the dev console after signing in on `localhost:5173`: `await __woutist.spike()`. It creates a temporary list and deletes it afterwards.

| Topic | Result | How Woutist uses it |
|---|---|---|
| Writing `dueDateTime` / `reminderDateTime` with an **IANA zone** (`Europe/Brussels`) | Accepted. Stored and returned **in UTC by default** (`2026-11-05T23:00:00`, `UTC`) | Writes local wall time + IANA zone |
| Reading with `Prefer: outlook.timezone="Europe/Brussels"` | Returned in that zone (`2026-11-06T00:00:00`, `Europe/Brussels`) | Every read sends the browser's zone. Due date = date part. UTC values from other clients are converted |
| `GET …/tasks?$expand=checklistItems,linkedResources` | Steps included. **Empty collections are omitted** (no key) | Mappers default missing collections to `[]` |
| `GET …/tasks/delta?$expand=checklistItems,linkedResources` | Works. **The deltaLink keeps the `$expand`**, so changed tasks arrive with their steps | Initial sync = one delta round. Incremental = apply delta items directly |
| Delta after adding/checking a step | The task is reported as changed | No separate step polling needed |
| Delta pagination | The first response can carry only `@odata.nextLink`. The deltaLink comes on the last page | `TaskService.collect()` follows `nextLink` |
| Completing a **recurring** task | The **original id stays open** with the next due date (+1 interval). A **new completed copy** with a new id is created. Delta reports both | Nothing special: the next sync shows the same result as the official app |
| `wellknownListName` values | `defaultList` for *Tasks*. No `flaggedEmails` list unless the mailbox has one | Flagged email shown only when present |
| Small attachments (`taskFileAttachment`, base64) | 201. Listing with `$select` returns metadata | Upload sessions are used above 3 MB |
| `/me/outlook/masterCategories` (personal account) | 200 | Category names + colors |
| Category writes on `/me/outlook/masterCategories` (personal account, 2026-11-06) | `POST` and `DELETE` work. `PATCH color` works. **`PATCH displayName` does not rename**: observed through the app, the category kept its old name and id while the app carried on as if it had been renamed. Treat a rename as done only when the returned `displayName` is the one you sent. Not yet confirmed: the exact status code of that PATCH (run `await __woutist.spike()`, which now prints `categoryWrites.renameStatus` and `renameReturnedName`), whether To Do cascades anything, and what a case-only duplicate returns | Settings > Categories. Rename = PATCH, check the returned name, otherwise create the new category, re-tag the tasks, delete the old one. Delete = strip the name from the tasks, then delete the category |
| `/me/photo/$value` without a photo | 404 | Initials avatar |
| `/me/todo/lists/delta` | Works | Not needed: lists are read in full (one cheap request) |
| Reminder changed through Graph, official Android app closed (2026-11-05) | Graph has the right time, but the phone app doesn't hear about the change until it syncs. A reminder set 1 minute ahead didn't fire. The same change made on to-do.office.com did fire, and so did the Graph change once the app was opened | Woutist's own push handles short-notice reminders; documented as a known limitation |
| `GET …/tasks?$filter=status ne 'completed'` (2026-11-05) | Works: only open tasks | The Android app's background refresh reads open tasks only |
| `GET …/tasks?$filter=status eq 'completed' and completedDateTime/dateTime ge '<UTC>'` (2026-11-06) | Works (200). So do `completedDateTime/dateTime ge …` alone, `$orderby=completedDateTime/dateTime desc`, and `lastModifiedDateTime ge <instant>` (unquoted) | The Android refresh reads the Today widget's completed tasks this way, from local midnight a day early (in UTC), and checks the local date itself. If Graph ever answers 400, it keeps the previous snapshot's tasks completed today |
| `GET …/tasks?$select=…` (2026-11-05) | **Any `$select` that includes `title` returns 400 `invalidRequest`**; selects without `title` work | The Android refresh reads full tasks (no `$select`) and maps only what it needs |
| Optional task fields (`dueDateTime`, `reminderDateTime`, `recurrence`, `completedDateTime`) | Omitted when not set (no key) | Mappers treat a missing key as null |
| Open extensions on a list (`POST/GET/PATCH /me/todo/lists/{id}/extensions/{name}`) | Works (2026-11-05): create 201, get by name 200 with the custom properties, PATCH 200, missing name 404. **Creating an extension whose name already exists returns 201, not 409.** A settings change synced between the web app and the Android app | Woutist's synced settings (quick dates, reminder times) live on the default list. It reads before it writes and PATCHes when the extension exists, so it never relies on a 409 |

**Not available in Graph:** My Day, list groups (folders), manual task order, "Assigned to me" (Planner), sharing management.
